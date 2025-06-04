import { Storage } from '@google-cloud/storage';
import { Injectable, Logger } from '@nestjs/common';
import vision, { ImageAnnotatorClient } from "@google-cloud/vision";

import { ServiceJson } from './JSON/service-json';




@Injectable()
export class CloudService {
    private storage: Storage;
    private bucketName: string;

    private readonly logger = new Logger(CloudService.name);
    private client: ImageAnnotatorClient;

    constructor() {
        this.client = new vision.ImageAnnotatorClient({
            credentials: ServiceJson
        })
        this.storage = new Storage({
            credentials: ServiceJson
        })
        this.bucketName = process.env.GCP_BUCKET_NAME;
    }
    async extractTransactionIdFromGCS(filePath: string): Promise<string | null> {
        try {
            const gcsUri = `gs://${this.bucketName}/${filePath}`;
            this.logger.log(`GCS URI: ${gcsUri}`);

            const [result] = await this.client.textDetection(gcsUri);
            const detections = result.textAnnotations;

            let fullText = result.fullTextAnnotation?.text || detections[0]?.description || '';

            if (!fullText) {
                this.logger.warn('No text detected in image.');
                return null;
            }

            // Pre-clean OCR text
            fullText = fullText
                .replace(/\n/g, ' ')
                .replace(/\s{2,}/g, ' ')
                .trim();

            this.logger.log(`Extracted OCR text: ${fullText}`);

            // Directly search for first standalone 12-digit number
            const match = fullText.match(/\b\d{12}\b/);

            if (match) {
                this.logger.log(`Found 12-digit Transaction ID: ${match[0]}`);
                return match[0];
            } else {
                this.logger.warn('No valid 12-digit Transaction ID found.');
                return null;
            }

        } catch (error) {
            this.logger.error('Error during OCR processing:', error);
            throw error;
        }
    }








    async uploadFile(fileBuffer: Buffer, originalName: string, contentType: string): Promise<string> {
        this.logger.log(`Uploading Image File Buffer...`)
        try {

            const bucket = this.storage.bucket(this.bucketName);
            const destination = `customer-sent/${Date.now()}-${originalName}`;
            const file = bucket.file(destination);
            await file.save(fileBuffer, {
                metadata: {
                    contentType,
                },
                resumable: false,
            });
            await file.makePublic();
            return `https://storage.googleapis.com/${this.bucketName}/${destination}`;

        } catch (error) {
            this.logger.error('Error uploading file to GCS', error);
            throw new Error('File upload failed');
        }
    }


    async refundStatus(url: string) {
        const destination = this.extractDestination(url);
        const transactionIds = await this.extractTransactionIdFromGCS(destination);
        this.logger.log(`Checking refund status for UTR ID: ${transactionIds}`);
        return transactionIds;
    }

    extractDestination(url: string): string {

        this.logger.debug(`Type of URL: ${typeof url}`);

        const prefix = `https://storage.googleapis.com/${this.bucketName}/`;
        this.logger.debug(`Matching prefix: ${prefix}`);
        this.logger.debug(`Full URL: ${url}`);
        if (typeof url !== 'string' || !url.startsWith(prefix)) {
            throw new Error('Invalid URL format or type.');
        }
        return url.slice(prefix.length);
    }




}
