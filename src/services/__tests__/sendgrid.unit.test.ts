import { jest } from '@jest/globals';

// Mock @sendgrid/client and @sendgrid/mail BEFORE importing the service.
// Each test grabs a fresh mock by re-importing the service module.

const mockRequest = jest.fn() as jest.MockedFunction<any>;
const mockSetApiKey = jest.fn();

jest.unstable_mockModule('@sendgrid/client', () => ({
  Client: jest.fn().mockImplementation(() => ({
    setApiKey: mockSetApiKey,
    request: mockRequest,
  })),
}));

// Dynamic import after mocks are registered
const { SendGridService } = await import('../sendgrid.js');

describe('SendGridService unit tests', () => {
  let service: InstanceType<typeof SendGridService>;

  beforeEach(() => {
    mockRequest.mockReset();
    service = new SendGridService('SG.test_key_for_unit_tests_only');
  });

  describe('deleteContactsByEmails', () => {
    it('returns 0 and skips DELETE when no contacts match the search', async () => {
      mockRequest.mockResolvedValueOnce([{ body: { result: [] } }, {}]);

      const deleted = await service.deleteContactsByEmails(['nobody@example.com']);

      expect(deleted).toBe(0);
      expect(mockRequest).toHaveBeenCalledTimes(1); // search only, no DELETE
    });

    it('returns the count actually deleted (not the count requested) when some emails do not exist', async () => {
      // Search returns 2 contacts (3 emails were requested)
      mockRequest
        .mockResolvedValueOnce([
          { body: { result: [{ id: 'c1', email: 'a@b.com' }, { id: 'c2', email: 'c@d.com' }] } },
          {},
        ])
        .mockResolvedValueOnce([{ body: {} }, {}]); // DELETE response

      const deleted = await service.deleteContactsByEmails(['a@b.com', 'c@d.com', 'missing@x.com']);

      expect(deleted).toBe(2);
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it('escapes single quotes in emails to prevent query injection', async () => {
      mockRequest.mockResolvedValueOnce([{ body: { result: [] } }, {}]);

      await service.deleteContactsByEmails(["o'malley@test.com"]);

      const searchCall = mockRequest.mock.calls[0][0];
      expect(searchCall.body.query).toContain("'o\\'malley@test.com'");
    });
  });

  describe('getStats', () => {
    it('strips undefined optional params before sending to the API', async () => {
      mockRequest.mockResolvedValueOnce([{ body: [] }, {}]);

      await service.getStats({ start_date: '2026-01-01' });

      const call = mockRequest.mock.calls[0][0];
      expect(call.qs).toEqual({ start_date: '2026-01-01' });
      expect(call.qs).not.toHaveProperty('end_date');
      expect(call.qs).not.toHaveProperty('aggregated_by');
    });

    it('passes through all defined params', async () => {
      mockRequest.mockResolvedValueOnce([{ body: [] }, {}]);

      await service.getStats({
        start_date: '2026-01-01',
        end_date: '2026-01-31',
        aggregated_by: 'day',
      });

      const call = mockRequest.mock.calls[0][0];
      expect(call.qs).toEqual({
        start_date: '2026-01-01',
        end_date: '2026-01-31',
        aggregated_by: 'day',
      });
    });
  });

  describe('createTemplate', () => {
    it('cleans up the orphaned template if version creation fails', async () => {
      mockRequest
        .mockResolvedValueOnce([{ body: { id: 'tpl-abc' } }, {}]) // POST template (success)
        .mockRejectedValueOnce(new Error('version API exploded')) // POST version (fail)
        .mockResolvedValueOnce([{ body: {} }, {}]); // DELETE template cleanup

      await expect(
        service.createTemplate({
          name: 'X',
          html_content: '<p>hi</p>',
          plain_content: 'hi',
          subject: 'subject',
        })
      ).rejects.toThrow('version API exploded');

      // Verify cleanup DELETE was called
      expect(mockRequest).toHaveBeenCalledTimes(3);
      const deleteCall = mockRequest.mock.calls[2][0];
      expect(deleteCall.method).toBe('DELETE');
      expect(deleteCall.url).toBe('/v3/templates/tpl-abc');
    });
  });

  describe('listAllContacts pagination', () => {
    it('follows _metadata.next cursor across multiple pages', async () => {
      mockRequest
        .mockResolvedValueOnce([
          {
            body: {
              result: [{ id: 'c1', email: 'a@b.com' }, { id: 'c2', email: 'c@d.com' }],
              _metadata: { next: 'https://api.sendgrid.com/v3/marketing/contacts/search?token=page2' },
            },
          },
          {},
        ])
        .mockResolvedValueOnce([
          {
            body: {
              result: [{ id: 'c3', email: 'e@f.com' }],
              // no _metadata.next = last page
            },
          },
          {},
        ]);

      const all = await service.listAllContacts();

      expect(all).toHaveLength(3);
      expect(all.map((c: any) => c.id)).toEqual(['c1', 'c2', 'c3']);
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it('terminates cleanly when first page returns no results', async () => {
      mockRequest.mockResolvedValueOnce([{ body: { result: [] } }, {}]);

      const all = await service.listAllContacts();

      expect(all).toEqual([]);
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('URL path validation', () => {
    it('rejects path traversal attempts in IDs', async () => {
      await expect(service.getList('../../v3/user/profile')).rejects.toThrow(/Invalid listId/);
      await expect(service.deleteList('../admin')).rejects.toThrow(/Invalid listId/);
      await expect(service.getTemplate('../../sensitive')).rejects.toThrow(/Invalid templateId/);
      await expect(service.scheduleSingleSend('../../send', 'now')).rejects.toThrow(/Invalid singleSendId/);

      // None of the above should have made HTTP calls
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('accepts valid SendGrid ID formats (UUIDs and dynamic template IDs)', async () => {
      mockRequest.mockResolvedValue([{ body: {} }, {}]);

      await service.getList('abc12345-6789-4def-9012-345678901234');
      await service.getTemplate('d-abc123def456');

      expect(mockRequest).toHaveBeenCalledTimes(2);
    });
  });
});
