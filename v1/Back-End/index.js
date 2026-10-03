const Config = require('./Config.json');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const httpPort = Config.HTTP_PORT;
const httpsPort = Config.HTTPS_PORT;
const databaseURL = Config.DATABASE_URL;
const privateKeyFilePath = Config.PRIVATE_KEY_FILEPATH;
const certificateFilePath = Config.CERTIFICATE_FILEPATH;
const caCertificateFilePath = Config.CA_CERT_FILEPATH;
const pemPassphrase = Config.PEM_PASSPHRASE;

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

let privateKey;
try {
    privateKey = fs.readFileSync(privateKeyFilePath, 'utf8');

}catch(error) {
    console.log("ERROR: Could not find private key!");
}

let certificate;
try {
    certificate = fs.readFileSync(certificateFilePath, 'utf8');

}catch(error) {
    console.log("ERROR: Could not find certificate!");
}

let caCert;
try {
    caCert = fs.readFileSync(caCertificateFilePath, 'utf8');

}catch(error) {
    console.log("ERROR: Could not find chain certificate!")
}

fs.access('./uploads', (error) => {
    if(error) {
        console.log("No uploads directory found, creating a new one...");
        fs.mkdir('./uploads', (err) => {
            if(err) {
                console.log("Uploads directory creation failed!", err);

            }else {
                console.log("Uploads directory created successfully!");
            }
        });
    }
});

fs.access('./www', (error) => {
    if(error) {
        console.log("No static files directory found, creating a new one...");
        fs.mkdir('./www', (err) => {
            if(err) {
                console.log("Static files directory creation failed!", err);

            }else {
                console.log("Static files directory created successfully!");
            }
        });
    }    
});

const certs = {key: privateKey, passphrase: pemPassphrase, cert: certificate, ca: caCert};

const httpServer = http.createServer(app);
const httpsServer = https.createServer(certs, app);

httpsServer.listen(httpsPort, (error) => {
    if(error) console.log(error);
    console.log("HTTPS Server started on port " + httpsPort); 
});

httpServer.listen(httpPort, (error) => {
    if(error) console.log(error);
    console.log("HTTP Server started on port " + httpPort);
});

mongoose.connect(databaseURL, { useNewUrlParser: true, useUnifiedTopology: true });
const db = mongoose.connection;
db.on('error', (error) => console.error(error));
db.once('open', () => console.log("Connected to database!"));

app.use(express.static('www'));
app.get(['/', '/home', '/upload', '/files', '/ca'], async (req, res) => {
    res.sendFile(path.join(__dirname, 'www', 'index.html'));
});

const accountRouter = require('./routes/Account');
app.use('/api/account', accountRouter);

const authenticationRouter = require('./routes/Authentication');
app.use('/api/authentication', authenticationRouter);

const filesRouter = require('./routes/Files');
app.use('/', filesRouter);
