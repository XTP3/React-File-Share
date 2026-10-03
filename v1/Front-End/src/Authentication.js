const Config = require('./Config.json');
const axios = require('axios');

const serverURL = Config.SERVER_URL;

class Authentication {
    static async performLogin(username, password) {
        const url = serverURL + "/api/authentication/login";
        return await axios.post(url, {
            username: username,
            password: password
         });
    }

    static async validateToken(token) {
        const url = serverURL + "/api/authentication/token";
        let authorizationToken = "Bearer " + token;
        return await axios({
            method: "POST",
            url: url,
            headers: { 'Content-Type': 'multipart/form-data', 'authorization': authorizationToken },
            
        });
    }
}

export default Authentication;