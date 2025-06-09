import { Body, Controller, Get, Res, Logger, Post, Query, Param, Next } from '@nestjs/common';
import { Response } from 'express';
import { ApiCreatedResponse, ApiTags } from '@nestjs/swagger';

// Local imports
import { CustomerService } from './customer.service';
import { ChatEntity } from 'src/chat/entity/chat.entity';
import { GGBackendService } from './gg-backend/gg-backend.service';
import { error } from 'console';

@Controller('read/webhook')
@ApiTags('customer')
export class CustomerController {
  private readonly appSecret = process.env.WHATSAPP_APP_SECRET; // WhatsApp secret for verifying webhook
  private readonly logger = new Logger(CustomerController.name); // Properly initialize logger

  constructor(private readonly customerService: CustomerService, private readonly ggAppBackend: GGBackendService) { }

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

  @Post() // Handling messages from WhatsApp
  @ApiCreatedResponse({ type: ChatEntity })
  async handleIncomingMessage(@Body() body: any): Promise<any> {
    this.logger.log(`Received incoming message: ${JSON.stringify(body)}`);
    return this.customerService.processIncomingMessage(body); // Process message with customer service
  }

  @Get('approved-t')
  async getApprovedTemplates() {
    return await this.customerService.getApprovedTemplates();
  }

  @Post('test-msg')
  async testMsgProccessing(@Body() body: any) {
    await this.customerService.processIncomingMessage(body);
  }

  @Post('send-t')
  async sendTemplateMessage(@Body() body: {
    to: string;
    templateName: string;
    languageCode: string;
    parameters: { type: string; text: string }[];
  }) {
    const { to, templateName, languageCode, parameters } = body;
    return await this.customerService.sendTemplateMessage(to, templateName, languageCode, parameters);
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


  @Post('customer-data-post')
  async getCustomerDataByPost(@Body() payload: {
    orderTime: string,
    machine_id: string
  }) {
    if (!payload) {
      return null;
    }
    const {
      orderTime, machine_id
    } = payload;

    this.logger.log(`received filtered request to fetch customer-data:${orderTime}, ${machine_id}`);
    return await this.ggAppBackend.getCustomerDataByPost(orderTime, machine_id);
  }



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