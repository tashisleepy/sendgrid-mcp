import { jest } from '@jest/globals';

const mockRequest = jest.fn() as jest.MockedFunction<any>;

jest.unstable_mockModule('@sendgrid/client', () => ({
  Client: jest.fn().mockImplementation(() => ({
    setApiKey: jest.fn(),
    request: mockRequest,
  })),
}));

const { SendGridService } = await import('../../services/sendgrid.js');

describe('handleToolCall (unit)', () => {
  let service: InstanceType<typeof SendGridService>;
  const ORIGINAL_READ_ONLY = process.env.SENDGRID_READ_ONLY;

  beforeEach(() => {
    mockRequest.mockReset();
  });

  afterEach(() => {
    if (ORIGINAL_READ_ONLY === undefined) {
      delete process.env.SENDGRID_READ_ONLY;
    } else {
      process.env.SENDGRID_READ_ONLY = ORIGINAL_READ_ONLY;
    }
  });

  describe('Zod validation gate', () => {
    it('rejects unknown tool with a clean error', async () => {
      delete process.env.SENDGRID_READ_ONLY;
      const { handleToolCall } = await import('../index.js');
      service = new SendGridService('SG.x');

      await expect(handleToolCall(service, 'totally_made_up_tool', {})).rejects.toThrow(
        /Unknown tool/
      );
    });

    it('rejects malformed args with a structured Zod error', async () => {
      delete process.env.SENDGRID_READ_ONLY;
      const { handleToolCall } = await import('../index.js');
      service = new SendGridService('SG.x');

      // delete_contacts requires emails: string[] of valid emails
      await expect(
        handleToolCall(service, 'delete_contacts', { emails: 'not-an-array' })
      ).rejects.toThrow(/Invalid arguments for delete_contacts/);

      await expect(
        handleToolCall(service, 'delete_contacts', { emails: ['definitely not an email'] })
      ).rejects.toThrow(/valid email/i);

      // No HTTP call made — validation rejected before service was called
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('rejects schedule_single_send when confirm is not literal true', async () => {
      delete process.env.SENDGRID_READ_ONLY;
      const { handleToolCall } = await import('../index.js');
      service = new SendGridService('SG.x');

      await expect(
        handleToolCall(service, 'schedule_single_send', {
          single_send_id: 'abc123',
          send_at: 'now',
          confirm: false,
        })
      ).rejects.toThrow(/confirm/);

      await expect(
        handleToolCall(service, 'schedule_single_send', {
          single_send_id: 'abc123',
          send_at: 'now',
          // confirm omitted entirely
        })
      ).rejects.toThrow(/confirm/);

      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('rejects get_stats when end_date is before start_date', async () => {
      delete process.env.SENDGRID_READ_ONLY;
      const { handleToolCall } = await import('../index.js');
      service = new SendGridService('SG.x');

      await expect(
        handleToolCall(service, 'get_stats', {
          start_date: '2026-03-01',
          end_date: '2026-02-01',
        })
      ).rejects.toThrow(/end_date must be on or after start_date/);

      expect(mockRequest).not.toHaveBeenCalled();
    });
  });

  describe('read-only mode (SENDGRID_READ_ONLY=1)', () => {
    it('blocks destructive tools when env flag is set', async () => {
      process.env.SENDGRID_READ_ONLY = '1';
      // Re-import the module to pick up the env change at module load
      jest.resetModules();
      const { handleToolCall } = await import('../index.js');
      service = new SendGridService('SG.x');

      await expect(
        handleToolCall(service, 'delete_contacts', { emails: ['a@b.com'] })
      ).rejects.toThrow(/read-only mode/);

      await expect(
        handleToolCall(service, 'create_contact_list', { name: 'X' })
      ).rejects.toThrow(/read-only mode/);

      await expect(
        handleToolCall(service, 'schedule_single_send', {
          single_send_id: 'abc123',
          send_at: 'now',
          confirm: true,
        })
      ).rejects.toThrow(/read-only mode/);

      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('allows read-only tools when env flag is set', async () => {
      process.env.SENDGRID_READ_ONLY = '1';
      jest.resetModules();
      const { handleToolCall } = await import('../index.js');
      service = new SendGridService('SG.x');

      mockRequest.mockResolvedValueOnce([{ body: { result: [] } }, {}]);

      const result = await handleToolCall(service, 'list_contact_lists', {});

      expect(result.content[0].text).toContain('[]');
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });
  });
});
