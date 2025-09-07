import { BadRequestException, Body, Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express'; // ✅ Fix Type Error
import { CloudService } from './cloud.service';

@Controller('cloud')
export class CloudController {
  constructor(private readonly cloudService: CloudService) { }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new Error('No file uploaded');
    }

    const uploadedUrl = await this.cloudService.uploadFile(
      file.buffer,
      file.originalname,
      file.mimetype
    );

    return { url: uploadedUrl };
  }

  @Post('doc-upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDoc(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new Error('No file uploaded');
    const uploadedUrl = await this.cloudService.savePdfFromWebhook(file.buffer, file.originalname);
    return { url: uploadedUrl }
  }


  @Post('extract-upi')
  async extractUPI(@Body() body: { gcsFilePath: string }) {
    const { gcsFilePath } = body;


    if (!gcsFilePath) {
      throw new BadRequestException('GCS file path is required');
    }

    const transactionId = await this.cloudService.extractTransactionIdFromGCS(gcsFilePath);

    return {
      filePath: gcsFilePath,
      transactionId,
    };
  }


}
