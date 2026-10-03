const Config = require('../Config.json');
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { nanoid } = require('nanoid');
const User = require('../models/User');
const fs = require('fs');
const vToken = require('../VerifyToken');

const accountCreationCode = Config.ACCOUNT_CREATION_CODE;
const saltRounds = Config.BCRYPT_SALT_ROUNDS;
const vt = vToken.verifyToken;
const dateTimeZoneRegion = Config.DATE_TIMEZONE_REGION;

//This file handles routes inbound to /api/account

async function hashPassword(plaintextPassword) {
    
    return bcrypt.hash(plaintextPassword, saltRounds);
}

async function createNewFolder(folderName) {
    fs.mkdir("./uploads/" + folderName, function(err){
        if(err) {
            return console.error(err);

        }else{
            console.log("Directory Creation Success");
        }
    });
}

router.post('/create', async(req, res) => {
    const receivedCreationCode = req.body.creationCode;

    if(receivedCreationCode == accountCreationCode) {
        try {
            const username = req.body.username;
            const hashedPassword = await hashPassword(req.body.password);
            const uniqueID = nanoid();
            const timeOfCreation = Date.now();
            const user = new User({
                uniqueID: uniqueID,
                username: username,
                password: hashedPassword,
                timeOfCreation: timeOfCreation
            });

            await user.save();
            await createNewFolder(uniqueID);
            res.sendStatus(201);
            let dateNow = new Date(timeOfCreation).toLocaleString(dateTimeZoneRegion);
            console.log("[" + dateNow + "] Created new account with username " + username);

        } catch (error) {
            console.log(error);
            res.sendStatus(500);
        }

    }else {
        res.sendStatus(400);
    }
});

router.post('/change', vt, async (req, res) => {
    const uuid = req.uuid;
    const toChange = req.body.toChange;

    if(toChange === "password") { 
        const submittedCurrentPassword = req.body.currentPassword;
        const submittedNewPassword = req.body.newPassword;

        const user = await User.findOne({uniqueID: uuid});
        const passwordHash = user.password;

        const validPassword = await bcrypt.compare(submittedCurrentPassword, passwordHash);

        if(validPassword){
            const newPasswordHash = await hashPassword(submittedNewPassword);
            await User.updateOne({uniqueID: uuid}, {password: newPasswordHash});
            res.sendStatus(200);

        }else {
            res.sendStatus(400);
        }

    }else {
        res.sendStatus(400);
    }

});

module.exports = router;