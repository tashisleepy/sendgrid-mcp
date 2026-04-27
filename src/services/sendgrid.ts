import { Client } from '@sendgrid/client';
import sgMail from '@sendgrid/mail';
import { SendGridContact, SendGridList, SendGridTemplate, SendGridStats, SendGridSingleSend } from '../types/index.js';

// Escape single quotes and backslashes for SendGrid query DSL string literals.
// Prevents query injection when user-supplied values are interpolated into
// queries like `email IN ('${value}')` or `CONTAINS(list_ids, '${value}')`.
function escapeQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
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
  async deleteContactsByEmails(emails: string[]): Promise<void> {
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
  }

  async listAllContacts(): Promise<SendGridContact[]> {
    const [response] = await this.client.request({
      method: 'POST',
      url: '/v3/marketing/contacts/search',
      body: {
        query: "email IS NOT NULL" // Get all contacts that have an email
      }
    });
    return (response.body as { result: SendGridContact[] }).result || [];
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
    const [response] = await this.client.request({
      method: 'GET',
      url: `/v3/marketing/lists/${listId}`
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
    await this.client.request({
      method: 'DELETE',
      url: `/v3/marketing/lists/${listId}`
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

  async addContactsToList(listId: string, contactEmails: string[]) {
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

  async removeContactsFromList(listId: string, contactEmails: string[]) {
    // First get the contact IDs for the emails
    const [searchResponse] = await this.client.request({
      method: 'POST',
      url: '/v3/marketing/contacts/search',
      body: {
        query: `email IN (${contactEmails.map(email => `'${escapeQueryValue(email)}'`).join(',')}) AND CONTAINS(list_ids, '${escapeQueryValue(listId)}')`
      }
    });

    const contacts = (searchResponse.body as { result: SendGridContact[] }).result || [];
    const contactIds = contacts.map(contact => contact.id).filter(id => id) as string[];

    if (contactIds.length > 0) {
      // Remove the contacts from the list
      await this.client.request({
        method: 'DELETE',
        url: `/v3/marketing/lists/${listId}/contacts`,
        qs: {
          contact_ids: contactIds.join(',')
        }
      });
    }
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
    
    // Create the first version of the template
    const [versionResponse] = await this.client.request({
      method: 'POST',
      url: `/v3/templates/${templateId}/versions`,
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
    const [response] = await this.client.request({
      method: 'GET',
      url: `/v3/templates/${templateId}`
    });
    return response.body as SendGridTemplate;
  }

  async deleteTemplate(templateId: string): Promise<void> {
    await this.client.request({
      method: 'DELETE',
      url: `/v3/templates/${templateId}`
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
    const [response] = await this.client.request({
      method: 'PUT',
      url: `/v3/marketing/singlesends/${singleSendId}/schedule`,
      body: {
        send_at: sendAt
      }
    });
    return response.body;
  }

  async getSingleSend(singleSendId: string): Promise<SendGridSingleSend> {
    const [response] = await this.client.request({
      method: 'GET',
      url: `/v3/marketing/singlesends/${singleSendId}`
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
