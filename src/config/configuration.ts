import "dotenv/config";

export default () => ({
    port: parseInt(process.env['PORT'], 10) || 3000,
    jwt: {
        secret: process.env['JWT_SECRET'],
    },
    whatsapp: {
        wabaId: process.env['WABA_ID'],
        accessToken: process.env['WHATSAPP_ACCESS_TOKEN'],
        appSecret: process.env['WHATSAPP_APP_SECRET'],
        phoneNumber: process.env['WHATSAPP_PHONE_NO'],
    },
    ggBackendUrl: process.env['GG_BACKEND'],
});