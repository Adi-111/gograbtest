export const ServiceJson = {
    type: "service_account",
    project_id: "go-grab-bucket",
    private_key_id: process.env.GCP_PRIVATE_KEY_ID,
    private_key: process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: "go-grab-uploader@go-grab-bucket.iam.gserviceaccount.com",
    client_id: "105854007334869236141",
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/go-grab-uploader%40go-grab-bucket.iam.gserviceaccount.com",
    universe_domain: "googleapis.com"
}
