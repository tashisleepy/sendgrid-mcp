import { Client } from '@sendgrid/client';
import { SendGridContact, SendGridList, SendGridTemplate, SendGridStats, SendGridSingleSend } from '../types/index.js';
import { withRetry } from '../utils/retry.js';
import { logger } from '../utils/logger.js';

// Escape single quotes and backslashes for SendGrid query DSL string literals.
// Prevents query injection when user-supplied values are interpolated into
// queries like `email IN ('${value}')` or `CONTAINS(list_ids, '${value}')`.
function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// SendGrid IDs are alphanumeric with optional hyphens/underscores (e.g. UUIDs,
// dynamic template IDs like `d-abc123`). This guard prevents path traversal
// when an LLM-supplied ID is interpolated into a REST URL path. Without it,
// an ID like `../user/profile` would route the request to a different endpoint.
function validateSendGridId(id: unknown, label: string): string {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid ${label}: must be alphanumeric with optional hyphens/underscores`);
  }
  return id;
}

// Hard cap on any pagination loop. Real consultant accounts won't reach this;
// the cap is a safety rail against infinite-loop bugs in next-cursor handling.
const MAX_PAGE_LOOPS = 200;

export class SendGridService {
  private client: Client;

  constructor(apiKey: string) {
    this.client = new Client();
    this.client.setApiKey(apiKey);
  }

  // ──────────────────────────────────────────────────────────────────
  // Contact Management
  // ──────────────────────────────────────────────────────────────────

  // Returns the number of contacts actually deleted (which may be less than
  // emails.length if some emails do not match any existing contact).
  async deleteContactsByEmails(emails: string[]): Promise<number> {
    const [searchResponse] = await withRetry('contacts.search', () =>
      this.client.request({
        method: 'POST',
        url: '/v3/marketing/contacts/search',
        body: {
          query: `email IN (${emails.map(e => `'${escapeQueryValue(e)}'`).join(',')})`,
        },
      })
    );

    const contacts = (searchResponse.body as { result: SendGridContact[] }).result || [];
    const contactIds = contacts.map(c => c.id).filter(id => id) as string[];

    if (contactIds.length > 0) {
      // DELETE by id is idempotent — second call would 404 but is harmless
      await withRetry('contacts.delete', () =>
        this.client.request({
          method: 'DELETE',
          url: '/v3/marketing/contacts',
          qs: { ids: contactIds.join(',') },
        })
      );
    }

    return contactIds.length;
  }

  // Walks SendGrid's contact search pagination and returns every result.
  // Capped at MAX_CONTACTS as a safety rail.
  async listAllContacts(): Promise<SendGridContact[]> {
    const MAX_CONTACTS = 10000;
    const all: SendGridContact[] = [];
    let nextUrl: string | undefined;

    for (let i = 0; i < MAX_PAGE_LOOPS && all.length < MAX_CONTACTS; i++) {
      const [response] = await withRetry('contacts.list', () =>
        this.client.request(
          nextUrl
            ? { method: 'GET', url: nextUrl }
            : {
                method: 'POST',
                url: '/v3/marketing/contacts/search',
                body: { query: 'email IS NOT NULL' },
              }
        )
      );

      const body = response.body as {
        result?: SendGridContact[];
        _metadata?: { next?: string };
      };

      const page = body.result || [];
      if (page.length === 0) break;
      all.push(...page);

      nextUrl = body._metadata?.next;
      if (!nextUrl) break;
    }

    return all;
  }

  // PUT /v3/marketing/contacts is an upsert keyed by email — running it twice
  // with the same payload yields the same final state. Safe to retry.
  async addContact(contact: SendGridContact) {
    const [response] = await withRetry('contact.upsert', () =>
      this.client.request({
        method: 'PUT',
        url: '/v3/marketing/contacts',
        body: { contacts: [contact] },
      })
    );
    return response;
  }

  async getContactsByList(listId: string): Promise<SendGridContact[]> {
    const safeId = validateSendGridId(listId, 'listId');
    const [response] = await withRetry('contacts.byList', () =>
      this.client.request({
        method: 'POST',
        url: '/v3/marketing/contacts/search',
        body: { query: `CONTAINS(list_ids, '${escapeQueryValue(safeId)}')` },
      })
    );
    return (response.body as { result: SendGridContact[] }).result || [];
  }

  async getList(listId: string): Promise<SendGridList> {
    const safeId = validateSendGridId(listId, 'listId');
    const [response] = await withRetry('list.get', () =>
      this.client.request({
        method: 'GET',
        url: `/v3/marketing/lists/${safeId}`,
      })
    );
    return response.body as SendGridList;
  }

  async listContactLists(): Promise<SendGridList[]> {
    const [response] = await withRetry('lists.list', () =>
      this.client.request({
        method: 'GET',
        url: '/v3/marketing/lists',
      })
    );
    return (response.body as { result: SendGridList[] }).result || [];
  }

  async deleteList(listId: string): Promise<void> {
    const safeId = validateSendGridId(listId, 'listId');
    await withRetry('list.delete', () =>
      this.client.request({
        method: 'DELETE',
        url: `/v3/marketing/lists/${safeId}`,
      })
    );
  }

  // POST = creation. Marked idempotent: false so the retry wrapper rethrows
  // immediately on 429/5xx instead of risking duplicate lists with the same
  // name. Caller is responsible for retry logic if they want it.
  async createList(name: string): Promise<SendGridList> {
    const [response] = await withRetry(
      'list.create',
      () =>
        this.client.request({
          method: 'POST',
          url: '/v3/marketing/lists',
          body: { name },
        }),
      { idempotent: false }
    );
    return response.body as SendGridList;
  }

  // NOTE: This endpoint creates contacts that don't already exist as a side
  // effect. PUT keyed by email = idempotent.
  async addContactsToList(listId: string, contactEmails: string[]) {
    validateSendGridId(listId, 'listId');
    const [response] = await withRetry('contacts.addToList', () =>
      this.client.request({
        method: 'PUT',
        url: '/v3/marketing/contacts',
        body: {
          list_ids: [listId],
          contacts: contactEmails.map(email => ({ email })),
        },
      })
    );
    return response;
  }

  // Returns the number of contacts actually removed.
  async removeContactsFromList(listId: string, contactEmails: string[]): Promise<number> {
    const safeListId = validateSendGridId(listId, 'listId');
    const [searchResponse] = await withRetry('contacts.searchInList', () =>
      this.client.request({
        method: 'POST',
        url: '/v3/marketing/contacts/search',
        body: {
          query: `email IN (${contactEmails.map(e => `'${escapeQueryValue(e)}'`).join(',')}) AND CONTAINS(list_ids, '${escapeQueryValue(safeListId)}')`,
        },
      })
    );

    const contacts = (searchResponse.body as { result: SendGridContact[] }).result || [];
    const contactIds = contacts.map(c => c.id).filter(id => id) as string[];

    if (contactIds.length > 0) {
      await withRetry('list.removeContacts', () =>
        this.client.request({
          method: 'DELETE',
          url: `/v3/marketing/lists/${safeListId}/contacts`,
          qs: { contact_ids: contactIds.join(',') },
        })
      );
    }

    return contactIds.length;
  }

  // ──────────────────────────────────────────────────────────────────
  // Template Management
  // ──────────────────────────────────────────────────────────────────

  async createTemplate(params: {
    name: string;
    html_content: string;
    plain_content: string;
    subject: string;
  }): Promise<SendGridTemplate> {
    // First call is non-idempotent (POST create). Don't auto-retry.
    const [response] = await withRetry(
      'template.create',
      () =>
        this.client.request({
          method: 'POST',
          url: '/v3/templates',
          body: { name: params.name, generation: 'dynamic' },
        }),
      { idempotent: false }
    );

    const templateId = (response.body as { id: string }).id;

    try {
      const [versionResponse] = await withRetry(
        'template.createVersion',
        () =>
          this.client.request({
            method: 'POST',
            url: `/v3/templates/${validateSendGridId(templateId, 'templateId')}/versions`,
            body: {
              template_id: templateId,
              name: `${params.name} v1`,
              subject: params.subject,
              html_content: params.html_content,
              plain_content: params.plain_content,
              active: 1,
            },
          }),
        { idempotent: false }
      );

      return {
        id: templateId,
        name: params.name,
        generation: 'dynamic',
        updated_at: new Date().toISOString(),
        versions: [{
          id: (versionResponse.body as { id: string }).id,
          template_id: templateId,
          active: 1,
          name: `${params.name} v1`,
          html_content: params.html_content,
          plain_content: params.plain_content,
          subject: params.subject,
        }],
      };
    } catch (versionErr) {
      // Cleanup orphaned empty template
      try {
        await this.deleteTemplate(templateId);
      } catch (cleanupErr: any) {
        logger.error('Failed to clean up orphaned template', {
          templateId,
          message: cleanupErr?.message,
        });
      }
      throw versionErr;
    }
  }

  // Pagination via page_size + page_token until exhausted.
  async listTemplates(): Promise<SendGridTemplate[]> {
    const all: SendGridTemplate[] = [];
    let pageToken: string | undefined;

    for (let i = 0; i < MAX_PAGE_LOOPS; i++) {
      const qs: Record<string, string> = { generations: 'dynamic', page_size: '200' };
      if (pageToken) qs.page_token = pageToken;

      const [response] = await withRetry('templates.list', () =>
        this.client.request({
          method: 'GET',
          url: '/v3/templates',
          qs,
        })
      );

      const body = response.body as {
        templates?: SendGridTemplate[];
        _metadata?: { next?: string };
      };

      const page = body.templates || [];
      if (page.length === 0) break;
      all.push(...page);

      // Extract next page_token from the next URL if SendGrid provided one
      const nextUrl = body._metadata?.next;
      if (!nextUrl) break;
      const match = nextUrl.match(/[?&]page_token=([^&]+)/);
      if (!match) break;
      pageToken = decodeURIComponent(match[1]);
    }

    return all;
  }

  async getTemplate(templateId: string): Promise<SendGridTemplate> {
    const safeId = validateSendGridId(templateId, 'templateId');
    const [response] = await withRetry('template.get', () =>
      this.client.request({
        method: 'GET',
        url: `/v3/templates/${safeId}`,
      })
    );
    return response.body as SendGridTemplate;
  }

  async deleteTemplate(templateId: string): Promise<void> {
    const safeId = validateSendGridId(templateId, 'templateId');
    await withRetry('template.delete', () =>
      this.client.request({
        method: 'DELETE',
        url: `/v3/templates/${safeId}`,
      })
    );
  }

  // ──────────────────────────────────────────────────────────────────
  // Email validation, stats, single sends, suppressions, senders
  // ──────────────────────────────────────────────────────────────────

  async validateEmail(email: string) {
    const [response] = await withRetry('email.validate', () =>
      this.client.request({
        method: 'POST',
        url: '/v3/validations/email',
        body: { email },
      })
    );
    return response.body;
  }

  async getStats(params: {
    start_date: string;
    end_date?: string;
    aggregated_by?: 'day' | 'week' | 'month';
  }): Promise<SendGridStats> {
    // Strip undefined values so the SendGrid API doesn't receive literal "undefined"
    const qs = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v != null)
    );
    const [response] = await withRetry('stats.get', () =>
      this.client.request({
        method: 'GET',
        url: '/v3/stats',
        qs,
      })
    );
    return response.body as SendGridStats;
  }

  // POST = creation. Don't auto-retry to avoid duplicate sends.
  async createSingleSend(params: {
    name: string;
    send_to: { list_ids: string[] };
    email_config: {
      subject: string;
      html_content: string;
      plain_content: string;
      sender_id: number;
      suppression_group_id?: number;
      custom_unsubscribe_url?: string;
    };
  }): Promise<{ id: string }> {
    const [response] = await withRetry(
      'singleSend.create',
      () =>
        this.client.request({
          method: 'POST',
          url: '/v3/marketing/singlesends',
          body: params,
        }),
      { idempotent: false }
    );
    return response.body as { id: string };
  }

  // PUT to schedule is semantically idempotent (same target time → same end
  // state). Safe to retry.
  async scheduleSingleSend(singleSendId: string, sendAt: 'now' | string) {
    const safeId = validateSendGridId(singleSendId, 'singleSendId');
    const [response] = await withRetry('singleSend.schedule', () =>
      this.client.request({
        method: 'PUT',
        url: `/v3/marketing/singlesends/${safeId}/schedule`,
        body: { send_at: sendAt },
      })
    );
    return response.body;
  }

  async getSingleSend(singleSendId: string): Promise<SendGridSingleSend> {
    const safeId = validateSendGridId(singleSendId, 'singleSendId');
    const [response] = await withRetry('singleSend.get', () =>
      this.client.request({
        method: 'GET',
        url: `/v3/marketing/singlesends/${safeId}`,
      })
    );
    return response.body as SendGridSingleSend;
  }

  // Pagination via page_size + page_token until exhausted.
  async listSingleSends(): Promise<SendGridSingleSend[]> {
    const all: SendGridSingleSend[] = [];
    let pageToken: string | undefined;

    for (let i = 0; i < MAX_PAGE_LOOPS; i++) {
      const qs: Record<string, string> = { page_size: '100' };
      if (pageToken) qs.page_token = pageToken;

      const [response] = await withRetry('singleSends.list', () =>
        this.client.request({
          method: 'GET',
          url: '/v3/marketing/singlesends',
          qs,
        })
      );

      const body = response.body as {
        result?: SendGridSingleSend[];
        _metadata?: { next?: string };
      };

      const page = body.result || [];
      if (page.length === 0) break;
      all.push(...page);

      const nextUrl = body._metadata?.next;
      if (!nextUrl) break;
      const match = nextUrl.match(/[?&]page_token=([^&]+)/);
      if (!match) break;
      pageToken = decodeURIComponent(match[1]);
    }

    return all;
  }

  async getSuppressionGroups() {
    const [response] = await withRetry('suppression.list', () =>
      this.client.request({
        method: 'GET',
        url: '/v3/asm/groups',
      })
    );
    return response.body;
  }

  async getVerifiedSenders() {
    const [response] = await withRetry('senders.list', () =>
      this.client.request({
        method: 'GET',
        url: '/v3/verified_senders',
      })
    );
    return response.body;
  }
}
