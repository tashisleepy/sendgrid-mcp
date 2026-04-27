import { Client } from '@sendgrid/client';
import sgMail from '@sendgrid/mail';
import { SendGridContact, SendGridList, SendGridTemplate, SendGridStats, SendGridSingleSend } from '../types/index.js';

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

export class SendGridService {
  private client: Client;

  constructor(apiKey: string) {
    this.client = new Client();
    this.client.setApiKey(apiKey);
    sgMail.setApiKey(apiKey);
  }

  // Email Sending
  async sendEmail(params: {
    to: string;
    from: string;
    subject: string;
    text: string;
    html?: string;
    template_id?: string;
    dynamic_template_data?: Record<string, any>;
  }) {
    return await sgMail.send(params);
  }

  // Contact Management
  // Returns the number of contacts actually deleted (which may be less than
  // emails.length if some emails do not match any existing contact).
  async deleteContactsByEmails(emails: string[]): Promise<number> {
    // First get the contact IDs for the emails
    const [searchResponse] = await this.client.request({
      method: 'POST',
      url: '/v3/marketing/contacts/search',
      body: {
        query: `email IN (${emails.map(email => `'${escapeQueryValue(email)}'`).join(',')})`
      }
    });

    const contacts = (searchResponse.body as { result: SendGridContact[] }).result || [];
    const contactIds = contacts.map(contact => contact.id).filter(id => id) as string[];

    if (contactIds.length > 0) {
      // Then delete the contacts by their IDs
      await this.client.request({
        method: 'DELETE',
        url: '/v3/marketing/contacts',
        qs: {
          ids: contactIds.join(',')
        }
      });
    }

    return contactIds.length;
  }

  // Walks SendGrid's contact search pagination and returns every result.
  // Capped at MAX_CONTACTS as a safety rail against runaway iteration on
  // very large accounts.
  async listAllContacts(): Promise<SendGridContact[]> {
    const MAX_CONTACTS = 10000;
    const all: SendGridContact[] = [];
    let nextUrl: string | undefined;

    while (all.length < MAX_CONTACTS) {
      const [response] = await this.client.request(
        nextUrl
          ? { method: 'GET', url: nextUrl }
          : {
              method: 'POST',
              url: '/v3/marketing/contacts/search',
              body: { query: 'email IS NOT NULL' },
            }
      );

      const body = response.body as {
        result?: SendGridContact[];
        _metadata?: { next?: string };
      };

      const page = body.result || [];
      if (page.length === 0) break;
      all.push(...page);

      // SendGrid returns the absolute next URL in _metadata.next when more
      // pages exist; the @sendgrid/client request() accepts absolute URLs
      // and routes them correctly.
      nextUrl = body._metadata?.next;
      if (!nextUrl) break;
    }

    return all;
  }

  async addContact(contact: SendGridContact) {
    const [response] = await this.client.request({
      method: 'PUT',
      url: '/v3/marketing/contacts',
      body: {
        contacts: [contact]
      }
    });
    return response;
  }

  async getContactsByList(listId: string): Promise<SendGridContact[]> {
    const [response] = await this.client.request({
      method: 'POST',
      url: '/v3/marketing/contacts/search',
      body: {
        query: `CONTAINS(list_ids, '${escapeQueryValue(listId)}')`
      }
    });
    return (response.body as { result: SendGridContact[] }).result || [];
  }

  async getList(listId: string): Promise<SendGridList> {
    const safeId = validateSendGridId(listId, 'listId');
    const [response] = await this.client.request({
      method: 'GET',
      url: `/v3/marketing/lists/${safeId}`
    });
    return response.body as SendGridList;
  }

  async listContactLists(): Promise<SendGridList[]> {
    const [response] = await this.client.request({
      method: 'GET',
      url: '/v3/marketing/lists'
    });
    return (response.body as { result: SendGridList[] }).result || [];
  }

  async deleteList(listId: string): Promise<void> {
    const safeId = validateSendGridId(listId, 'listId');
    await this.client.request({
      method: 'DELETE',
      url: `/v3/marketing/lists/${safeId}`
    });
  }

  async createList(name: string): Promise<SendGridList> {
    const [response] = await this.client.request({
      method: 'POST',
      url: '/v3/marketing/lists',
      body: { name }
    });
    return response.body as SendGridList;
  }

  // NOTE: This endpoint creates contacts that don't already exist as a side
  // effect. Passing a brand-new email here both creates the contact AND adds
  // it to the list in a single PUT.
  async addContactsToList(listId: string, contactEmails: string[]) {
    validateSendGridId(listId, 'listId');
    const [response] = await this.client.request({
      method: 'PUT',
      url: '/v3/marketing/contacts',
      body: {
        list_ids: [listId],
        contacts: contactEmails.map(email => ({ email }))
      }
    });
    return response;
  }

  // Returns the number of contacts actually removed from the list (which may
  // be less than contactEmails.length if some emails are not on the list).
  async removeContactsFromList(listId: string, contactEmails: string[]): Promise<number> {
    const safeListId = validateSendGridId(listId, 'listId');
    // First get the contact IDs for the emails
    const [searchResponse] = await this.client.request({
      method: 'POST',
      url: '/v3/marketing/contacts/search',
      body: {
        query: `email IN (${contactEmails.map(email => `'${escapeQueryValue(email)}'`).join(',')}) AND CONTAINS(list_ids, '${escapeQueryValue(safeListId)}')`
      }
    });

    const contacts = (searchResponse.body as { result: SendGridContact[] }).result || [];
    const contactIds = contacts.map(contact => contact.id).filter(id => id) as string[];

    if (contactIds.length > 0) {
      // Remove the contacts from the list
      await this.client.request({
        method: 'DELETE',
        url: `/v3/marketing/lists/${safeListId}/contacts`,
        qs: {
          contact_ids: contactIds.join(',')
        }
      });
    }

    return contactIds.length;
  }

  // Template Management
  async createTemplate(params: {
    name: string;
    html_content: string;
    plain_content: string;
    subject: string;
  }): Promise<SendGridTemplate> {
    const [response] = await this.client.request({
      method: 'POST',
      url: '/v3/templates',
      body: {
        name: params.name,
        generation: 'dynamic'
      }
    });

    const templateId = (response.body as { id: string }).id;

    try {
      // Create the first version of the template
      const [versionResponse] = await this.client.request({
        method: 'POST',
        url: `/v3/templates/${validateSendGridId(templateId, 'templateId')}/versions`,
        body: {
          template_id: templateId,
          name: `${params.name} v1`,
          subject: params.subject,
          html_content: params.html_content,
          plain_content: params.plain_content,
          active: 1
        }
      });

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
          subject: params.subject
        }]
      };
    } catch (versionErr) {
      // Clean up the orphaned empty template so a failed version creation
      // doesn't leak template-quota inside the client's SendGrid account.
      try {
        await this.deleteTemplate(templateId);
      } catch (cleanupErr: any) {
        console.error('Failed to clean up orphaned template:', {
          templateId,
          message: cleanupErr?.message,
        });
      }
      throw versionErr;
    }
  }

  async listTemplates(): Promise<SendGridTemplate[]> {
    const [response] = await this.client.request({
      method: 'GET',
      url: '/v3/templates',
      qs: {
        generations: 'dynamic'
      }
    });
    return ((response.body as { templates: SendGridTemplate[] }).templates || []);
  }

  async getTemplate(templateId: string): Promise<SendGridTemplate> {
    const safeId = validateSendGridId(templateId, 'templateId');
    const [response] = await this.client.request({
      method: 'GET',
      url: `/v3/templates/${safeId}`
    });
    return response.body as SendGridTemplate;
  }

  async deleteTemplate(templateId: string): Promise<void> {
    const safeId = validateSendGridId(templateId, 'templateId');
    await this.client.request({
      method: 'DELETE',
      url: `/v3/templates/${safeId}`
    });
  }

  // Email Validation
  async validateEmail(email: string) {
    const [response] = await this.client.request({
      method: 'POST',
      url: '/v3/validations/email',
      body: { email }
    });
    return response.body;
  }

  // Statistics
  async getStats(params: {
    start_date: string;
    end_date?: string;
    aggregated_by?: 'day' | 'week' | 'month';
  }): Promise<SendGridStats> {
    // Strip undefined values so the SendGrid API doesn't receive literal "undefined"
    const qs = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v != null)
    );
    const [response] = await this.client.request({
      method: 'GET',
      url: '/v3/stats',
      qs
    });
    return response.body as SendGridStats;
  }

  // Single Sends (New Marketing Campaigns API)
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
    const [response] = await this.client.request({
      method: 'POST',
      url: '/v3/marketing/singlesends',
      body: params
    });
    return response.body as { id: string };
  }

  async scheduleSingleSend(singleSendId: string, sendAt: 'now' | string) {
    const safeId = validateSendGridId(singleSendId, 'singleSendId');
    const [response] = await this.client.request({
      method: 'PUT',
      url: `/v3/marketing/singlesends/${safeId}/schedule`,
      body: {
        send_at: sendAt
      }
    });
    return response.body;
  }

  async getSingleSend(singleSendId: string): Promise<SendGridSingleSend> {
    const safeId = validateSendGridId(singleSendId, 'singleSendId');
    const [response] = await this.client.request({
      method: 'GET',
      url: `/v3/marketing/singlesends/${safeId}`
    });
    return response.body as SendGridSingleSend;
  }

  async listSingleSends(): Promise<SendGridSingleSend[]> {
    const [response] = await this.client.request({
      method: 'GET',
      url: '/v3/marketing/singlesends'
    });
    return (response.body as { result: SendGridSingleSend[] }).result || [];
  }

  // Suppression Groups
  async getSuppressionGroups() {
    const [response] = await this.client.request({
      method: 'GET',
      url: '/v3/asm/groups'
    });
    return response.body;
  }

  // Verified Senders
  async getVerifiedSenders() {
    const [response] = await this.client.request({
      method: 'GET',
      url: '/v3/verified_senders'
    });
    return response.body;
  }
}
