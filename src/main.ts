import 'newrelic';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';



async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: ['http://localhost:3001', 'http://localhost:3000', 'https://gocare-fronend.vercel.app', '*', 'https://support-v2.vercel.app'], // Allow requests from Next.js frontend
    credentials: true, // Allow cookies & authentication headers
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], // Allowed HTTP methods
    allowedHeaders: ['Content-Type', 'Authorization'], // Allowed headers
  })
  const swaggerConfig = new DocumentBuilder()
    .setTitle('GoCare')
    .setDescription('a whatsapp based customer support application')
    .setVersion('1.0.0')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api', app, swaggerDocument);
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
