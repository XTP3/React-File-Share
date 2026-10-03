const Config = require('../Config.json');
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const vToken = require('../VerifyToken');

const secretKey = Config.JWT_SECRET_KEY;
const expiration = Config.JWT_EXPIRATION;
const dateTimeZoneRegion = Config.DATE_TIMEZONE_REGION;

const vt = vToken.verifyToken;

//This file handles routes inbound to /api/authentication

router.post('/login', async (req, res) => {
    const username = req.body.username;
    const plaintextPassword = req.body.password;
    const user = await User.findOne({username:username});

    if(user) {
        const validPassword = await bcrypt.compare(plaintextPassword, user.password);
        const uniqueID = user.uniqueID;

        if(validPassword) {
            jwt.sign({uniqueID}, secretKey, { expiresIn: expiration }, (err, token) => {
                res.json({token});
            });
            let dateNow = new Date(Date.now()).toLocaleString(dateTimeZoneRegion);
            console.log("[" + dateNow + "] Login: " + username);
        }else {
            res.sendStatus(401);
        }

    }else {
        res.sendStatus(401);
    }

});

router.post('/token', vt, async (req, res) => res.sendStatus(200));

module.exports = router;