import { Body, Controller, Get, Res, Logger, Post, Query, Param, Next } from '@nestjs/common';
import { Response } from 'express';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';

// Local imports
import { CustomerService } from './customer.service';
import { ChatEntity } from 'src/chat/entity/chat.entity';
import { GGBackendService } from './gg-backend/gg-backend.service';
import { error } from 'console';
import { SendTemplateBody, WAComponent } from './dto/send-template.dto';
import { Public } from 'src/auth/decorators/public.decorator';

@Controller('read/webhook')
@ApiTags('customer')
export class CustomerController {
  private readonly appSecret = process.env.WHATSAPP_APP_SECRET; // WhatsApp secret for verifying webhook
  private readonly logger = new Logger(CustomerController.name); // Properly initialize logger

  constructor(private readonly customerService: CustomerService, private readonly ggAppBackend: GGBackendService) { }

  @Public()
  @Get() // Verifying webhook
  async verifyWebhook(
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ): Promise<Response> {
    if (token === this.appSecret) {
      this.logger.log('Webhook verified successfully.');
      return res.status(200).send(challenge);
    }

    this.logger.warn('Webhook verification failed.');
    return res.sendStatus(403);
  }

  @Public()
  @Post() // Handling messages from WhatsApp
  @ApiCreatedResponse({ type: ChatEntity })
  async handleIncomingMessage(@Body() body: any): Promise<any> {
    this.logger.log(`Received incoming message: ${JSON.stringify(body)}`);
    return this.customerService.processIncomingMessage(body); // Process message with customer service
  }

  @Public()
  @Get('approved-t')
  async getApprovedTemplates() {
    return await this.customerService.getApprovedTemplates();
  }


  @Post('test-msg')
  async testMsgProccessing(@Body() body: any) {
    await this.customerService.processIncomingMessage(body);
  }


  @Public()
  @Post("send-t")
  async sendTemplateMessage(@Body() body: SendTemplateBody) {
    const { to } = body;
    if (!to) throw new Error("Field 'to' is required");

    // Build the general template object (supports both old and new shapes)
    const template =
      body.template ??
      {
        name: (body.templateName ?? "").trim(),
        languageCode: body.languageCode ?? "en",
        components:
          body.parameters && body.parameters.length
            ? ([{ type: "body", parameters: body.parameters }] as WAComponent[])
            : [],
      };

    if (!template?.name?.trim()) throw new Error("Template name is missing or empty");
    if (!template?.languageCode?.trim()) throw new Error("languageCode is missing or empty");

    // Delegate to your generalized sender in the service
    return this.customerService.sendWhatsAppTemplate({
      to,
      template,
    });
  }




  @Get('vend-info')
  async getVendInfo() {
    const order_id = "ORDER-GG1080-1748595367706";
    return await this.ggAppBackend.getVendDetails(order_id);
  }
  @Get('txn')
  async getProducts() {
    return await this.ggAppBackend.bankTxn('');
  }
  @Get('customer-data-&&$$')
  async customerData() {
    return await this.ggAppBackend.getCustomerData();
  }

  @Post('customer-data-v')
  async customerDataVerdict(@Body() payload: { id: number, verdict: string }) {
    const { id, verdict } = payload;
    this.logger.log(id, verdict);
    return await this.ggAppBackend.updateCustomerDataVerdict(id, verdict);
  }


  @Public()
  @Post('customer-data-post')
  async getCustomerDataByPost(@Body() payload: {
    startTime: string,
    endTime: string
    machine_id: string
  }) {
    if (!payload) {
      return null;
    }
    const {
      machine_id, startTime, endTime
    } = payload;

    this.logger.log(`received filtered request to fetch customer-data between :${startTime} & ${endTime}, ${machine_id}`);
    return await this.ggAppBackend.getCustomerDataByPost(startTime, endTime, machine_id);
  }


  @Get('get-all-machines')
  async getAllMachines() {
    return await this.ggAppBackend.getAllMachines();
  }

  @Get('upsert-machines')
  async upsertMachine() {
    return await this.ggAppBackend.getAllMachinesFromGG()
  }




  // @Get('agent-metric')
  // async agentMetrics(
  // ) {
  //   return await this.ggAppBackend.agentsChatRefundsAndFRTInRange()
  // }

  // @Get('getAllCustomer')
  // @ApiCreatedResponse({ type: [CustomerEntity] })
  // async getAllCustomer(): Promise<CustomerEntity[]> {
  //   return this.customerService.getAllCustomers();
  // }


  // @Post('refund-status')
  // async getRefundStatus(@Body() data: { url: string }) {
  //   this.logger.log(data.url)
  //   return this.customerService.handleRefundScreenshot(data.url);

  // }
}