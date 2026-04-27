import { jest } from '@jest/globals';

// Mock @sendgrid/client BEFORE importing the service.

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
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('returns the count actually deleted, not the count requested', async () => {
      mockRequest
        .mockResolvedValueOnce([
          { body: { result: [{ id: 'c1', email: 'a@b.com' }, { id: 'c2', email: 'c@d.com' }] } },
          {},
        ])
        .mockResolvedValueOnce([{ body: {} }, {}]);

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
  });

  describe('createTemplate', () => {
    it('cleans up the orphaned template if version creation fails', async () => {
      mockRequest
        .mockResolvedValueOnce([{ body: { id: 'tpl-abc' } }, {}])
        .mockRejectedValueOnce(new Error('version API exploded'))
        .mockResolvedValueOnce([{ body: {} }, {}]);

      await expect(
        service.createTemplate({
          name: 'X',
          html_content: '<p>hi</p>',
          plain_content: 'hi',
          subject: 'subject',
        })
      ).rejects.toThrow('version API exploded');

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
              _metadata: { next: 'https://api.sendgrid.com/v3/marketing/contacts/search?token=p2' },
            },
          },
          {},
        ])
        .mockResolvedValueOnce([
          { body: { result: [{ id: 'c3', email: 'e@f.com' }] } },
          {},
        ]);

      const all = await service.listAllContacts();

      expect(all).toHaveLength(3);
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it('terminates cleanly when first page is empty', async () => {
      mockRequest.mockResolvedValueOnce([{ body: { result: [] } }, {}]);
      const all = await service.listAllContacts();
      expect(all).toEqual([]);
    });
  });

  describe('listTemplates pagination', () => {
    it('follows page_token across pages and stops when no next is returned', async () => {
      mockRequest
        .mockResolvedValueOnce([
          {
            body: {
              templates: [{ id: 't1', versions: [] }, { id: 't2', versions: [] }],
              _metadata: { next: 'https://api.sendgrid.com/v3/templates?page_token=ABC123' },
            },
          },
          {},
        ])
        .mockResolvedValueOnce([
          {
            body: {
              templates: [{ id: 't3', versions: [] }],
            },
          },
          {},
        ]);

      const all = await service.listTemplates();

      expect(all).toHaveLength(3);
      expect(mockRequest).toHaveBeenCalledTimes(2);
      // Second call must include page_token
      const secondCallQs = mockRequest.mock.calls[1][0].qs;
      expect(secondCallQs.page_token).toBe('ABC123');
    });
  });

  describe('listSingleSends pagination', () => {
    it('paginates via page_token until exhausted', async () => {
      mockRequest
        .mockResolvedValueOnce([
          {
            body: {
              result: [{ id: 's1' }, { id: 's2' }],
              _metadata: { next: 'https://api.sendgrid.com/v3/marketing/singlesends?page_token=XYZ' },
            },
          },
          {},
        ])
        .mockResolvedValueOnce([
          { body: { result: [{ id: 's3' }] } },
          {},
        ]);

      const all = await service.listSingleSends();

      expect(all).toHaveLength(3);
      expect(mockRequest.mock.calls[1][0].qs.page_token).toBe('XYZ');
    });
  });

  describe('URL path validation', () => {
    it('rejects path traversal attempts in IDs before any HTTP call', async () => {
      await expect(service.getList('../../v3/user/profile')).rejects.toThrow(/Invalid listId/);
      await expect(service.deleteList('../admin')).rejects.toThrow(/Invalid listId/);
      await expect(service.getTemplate('../../sensitive')).rejects.toThrow(/Invalid templateId/);
      await expect(service.scheduleSingleSend('../../send', 'now')).rejects.toThrow(/Invalid singleSendId/);
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('accepts valid SendGrid ID formats', async () => {
      mockRequest.mockResolvedValue([{ body: {} }, {}]);

      await service.getList('abc12345-6789-4def-9012-345678901234');
      await service.getTemplate('d-abc123def456');

      expect(mockRequest).toHaveBeenCalledTimes(2);
    });
  });

  describe('retry behavior', () => {
    it('retries on 429 (rate limit) and succeeds on second attempt', async () => {
      const rateLimitError: any = new Error('Too Many Requests');
      rateLimitError.code = 429;
      rateLimitError.response = { statusCode: 429, headers: { 'retry-after': '0' } };

      mockRequest
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce([{ body: { result: [] } }, {}]);

      const result = await service.listContactLists();
      expect(result).toEqual([]);
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry creation operations (idempotent: false)', async () => {
      const rateLimitError: any = new Error('Too Many Requests');
      rateLimitError.code = 429;
      rateLimitError.response = { statusCode: 429, headers: {} };

      mockRequest.mockRejectedValueOnce(rateLimitError);

      await expect(service.createList('My List')).rejects.toThrow('Too Many Requests');
      // Critically: only one call. No retry to avoid duplicate list creation.
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 400 (caller bug, not transient)', async () => {
      const badRequestError: any = new Error('Bad Request');
      badRequestError.code = 400;
      badRequestError.response = { statusCode: 400 };

      mockRequest.mockRejectedValueOnce(badRequestError);

      await expect(service.listContactLists()).rejects.toThrow('Bad Request');
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('gives up after maxAttempts on persistent 5xx errors', async () => {
      const serverError: any = new Error('Internal Server Error');
      serverError.code = 500;
      serverError.response = { statusCode: 500, headers: { 'retry-after': '0' } };

      mockRequest.mockRejectedValue(serverError);

      await expect(service.listContactLists()).rejects.toThrow('Internal Server Error');
      // Default maxAttempts = 3
      expect(mockRequest).toHaveBeenCalledTimes(3);
    });
  });
});
