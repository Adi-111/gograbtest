import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ChatGateway } from './chat.gateway'; // Adjust path as needed
import { Server } from 'socket.io';
import * as io from 'socket.io-client';

describe('ChatGateway (WebSocket)', () => {
    let app: INestApplication;
    let server: Server;
    let client: io.Socket;

    beforeAll(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            providers: [ChatGateway],
        }).compile();

        app = moduleFixture.createNestApplication();
        await app.init();

        server = app.get<Server>(ChatGateway);
        await new Promise((resolve) => app.listen(3000));

        client = io.connect('http://localhost:3000', {
            transports: ['websocket'],
        });
    });

    afterAll(async () => {
        client.disconnect();
        await app.close();
    });

    it('should connect to WebSocket server', (done) => {
        client.on('connect', () => {
            expect(client.connected).toBeTruthy();
            done();
        });
    });

    it('should join a case room', (done) => {
        client.emit('join-case', { caseId: 123 });

        client.on('joined-room', (room) => {
            expect(room).toBe('case-123');
            done();
        });
    });

    it('should send and receive a message', (done) => {
        const testMessage = { caseId: 13, message: 'Hello from agent' };

        client.emit('new-message', testMessage);

        client.on('new-message', (data) => {
            expect(data.message).toBe(testMessage.message);
            done();
        });
    });

    it('should send and receive a WhatsApp message', (done) => {
        const testMessage = { caseId: 123, content: 'Hello from WhatsApp' };

        client.emit('w-message', testMessage);

        client.on('w-message', (data) => {
            expect(data.content).toBe(testMessage.content);
            done();
        });
    });
});
