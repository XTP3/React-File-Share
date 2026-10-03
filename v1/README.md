# About
A responsive, full-stack, headless, file sharing web-application using the MERN stack.

![Alt text](preview.png?raw=true "Preview")

## Features
 - Responsive (mobile-friendly)
 - Multiple File Upload
 - File Browser with sorting, searching, and unique shareable links
 - Self-hostable

## Installation

Download the latest repo.

### Server
#### Requirements
- NodeJS
- MongoDB
- TLS/SSL Certificates (recommended)

Enter the Back-End (server) directory and modify the Config.json accordingly:

```
{
    "HTTP_PORT": 80,
    "HTTPS_PORT": 443,
    "PRIVATE_KEY_FILEPATH": "/some/folder/server.key",
    "CERTIFICATE_FILEPATH": "/some/folder/server.cert",
    "CA_CERT_FILEPATH": "",
    "PEM_PASSPHRASE": "",
    "DATABASE_URL": "mongodb://localhost/DatabaseName",
    "ACCOUNT_CREATION_CODE": "someRandomCode",
    "BCRYPT_SALT_ROUNDS": 10,
    "JWT_SECRET_KEY": "someRandomCode",
    "JWT_EXPIRATION": "30m",
    "MAX_UPLOAD_SIZE": 10737418240,
    "DATE_LANGUAGE": "en-US",
    "DATE_TIMEZONE_REGION": "America/New_York"
}
```

- Note: If you are using LetsEncrypt/Certbot you will need to set a filepath for the private key, certificate, and certificate authority (CA).
- Note: File upload size is the maximum ALLOTTED file size permitted in one upload request, this means that the amount of files uploaded is irrelevant so long as they are equal to or beneath your limit size (in bytes).

### Client
#### Requirements
- NodeJS

Enter the Front-End (client) directory.

You will need to modify the front-end React Application and *manually* compile prior to deployment, as the configuration file is inaccessable during production.

Within the /src directory, you will need to connect your front-end to the back-end by modifying the Config.json file:

```
{
    "SERVER_URL": "https://website.com",
    "MAX_ALLOTTED_FILE_SIZE": 10737418240
}
```
Be sure to synchronize your max file size with that of your server.

Although not required, you may modify your page's title within the /public directory by modifying the index.html file:

```
<title>Website Title</title>
```

You can also modify the name of the react application directly as well as the description in the manifest.json:

```
{
  "short_name": "Website",
  "name": "Website.com description",
}
```

Enter the parent directory of the application's files and install the necessary packages/dependencies:
```
npm install
```

Compile the application into servable static files:
```
npm run build
```

Place the files generated within the /build directory within your back-end's /www folder, or some other HTTP(s) static content web server.

To start the server, enter the directory containing index.js and start using node:
```
node index.js
```

You will most likely need elevated privelages on most machines:
```
sudo node index.js
```

#### Conclusion

This app is very simple, and my very first full stack MERN app, not recommended for public production environments.
