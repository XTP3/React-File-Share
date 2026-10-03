const Config = require('../Config.json');
const express = require('express');
const multer = require('multer');
const vToken = require('../VerifyToken');
const { nanoid } = require('nanoid');
const router = express.Router();
const File = require('../models/File');
const path = require('path');
const fs = require('fs');

const vt = vToken.verifyToken;
const maxFileSize = Config.MAX_UPLOAD_SIZE;
const dateLanguage = Config.DATE_LANGUAGE;
const dateTimezoneRegion = Config.DATE_TIMEZONE_REGION;

//This file handles routes inbound to /api/files and /f

var storage = multer.diskStorage({
    destination: function (req, file, cb) {
        let filePath = './uploads/' + req.uuid;
        cb(null, filePath);
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});

var upload = multer({
    storage: storage,
    limits: {
        fileSize: maxFileSize
    }
});

router.post('/api/files/upload', vt, upload.any(), async (req, res) => {
    const files = req.files;
    if(!files) {
        res.sendStatus(400);

    }else {
        var totalSize = 0;
        var filesToInsert = [];
        Object.keys(files).forEach(file => {
            totalSize += files[file].size;
            let uniqueID = nanoid(10);
            let fileName = files[file].originalname;
            let fileSize = files[file].size;
            let fileType = files[file].mimetype;
            let uploaderID = req.uuid;
            let timeOfUpload = Date.now();
            let timeOfUploadDate = new Date(timeOfUpload).toLocaleString(dateLanguage, {timeZone: dateTimezoneRegion});
            filesToInsert.push({
                uniqueID: uniqueID,
                fileName: fileName,
                fileSize: fileSize,
                fileType: fileType,
                uploaderID: uploaderID,
                timeOfUpload: timeOfUpload,
                timeOfUploadDate: timeOfUploadDate
            });
        });

        let existsInDatabase;

        for(let file of filesToInsert) {
            let fileName = file.fileName;
            let uploaderID = file.uploaderID;
            existsInDatabase = await File.exists({fileName:fileName, uploaderID:uploaderID});
            break;
        }

        if(existsInDatabase) {
            res.sendStatus(409);
            
        }else {
            if(totalSize > maxFileSize) {
                res.sendStatus(413);
                console.log("Failed Upload: Payload too large");
    
            }else {
                await File.insertMany(filesToInsert);
                console.log("Upload Complete!");
                res.sendStatus(200);
            }
        }
    }
});

router.delete('/api/files/delete/:fileUUID', vt, async (req, res) => {
    const uploaderID = req.uuid;
    const fileUUID = req.params.fileUUID;
    const exists = await File.exists({uploaderID:uploaderID, uniqueID:fileUUID});
    if(exists) {
        const file = await File.findOne({uploaderID:uploaderID, uniqueID:fileUUID});
        let fileName = file.fileName;
        let filePath = "./uploads/" + uploaderID + "/" + fileName;
        fs.unlink(filePath, (error) => {
            if(error) {
                console.log(error);
                res.sendStatus(500);

            }
        });
        try {
            await File.deleteOne(file);
            res.sendStatus(200);
            console.log("File located at " + filePath + " has been deleted");

        }catch(error) {
            console.log(error);
        }
    }else {
        res.sendStatus(404);
    }
});

router.post('/f', vt, async(req, res) => {
    let uploaderID = req.uuid;
    let userHasFiles = await File.exists({uploaderID:uploaderID});
    if(userHasFiles) {
        let sortOrder = req.body.sortOrder;
        let usersFiles;
        
        if(sortOrder === "alphabetical") {
            usersFiles = await File.find({uploaderID:uploaderID}).collation({locale: "en"}).sort({"fileName": 1});
        
        }else if(sortOrder === "chronological") {
            usersFiles = await File.find({uploaderID:uploaderID}).collation({locale: "en"}).sort({"timeOfUpload": -1});

        }else if(sortOrder === "size") {
            usersFiles = await File.find({uploaderID:uploaderID}).collation({locale: "en"}).sort({"fileSize": -1});

        }else {
            usersFiles = await File.find({uploaderID:uploaderID});
        }
        res.json(usersFiles);

    }else {
        res.sendStatus(404);
    }
});

router.get('/f/d/:fileUUID', async(req, res) => {
    let fileUUID = req.params.fileUUID;
    const exists = await File.exists({uniqueID:fileUUID});
    if(exists) {
        const file = await File.findOne({uniqueID:fileUUID});
        let fileName = file.fileName;
        let uploaderID = file.uploaderID;
        res.download("./uploads/" + uploaderID + "/" + fileName, fileName);

    }else {
        res.sendStatus(404);
    }
});

router.get('/f/v/:fileUUID', async(req, res) => {
    let fileUUID = req.params.fileUUID;
    const exists = await File.exists({uniqueID:fileUUID});
    if(exists) {
        const file = await File.findOne({uniqueID:fileUUID});
        let fileName = file.fileName;
        let uploaderID = file.uploaderID;
        const fileLocation = "../uploads/" + uploaderID + "/";
        var options = {root: path.join(__dirname, fileLocation)}
        res.sendFile(fileName, options, (err) => {if(err) console.log(err);});

    }else {
        res.sendStatus(404);
    }
});

router.get('/f/s/:searchQuery', vt, async(req, res) => {
    let uploaderID = req.uuid;
    let searchQuery = req.params.searchQuery;
    const regex = new RegExp(searchQuery, 'i');
    let files = await File.find({uploaderID:uploaderID, fileName: {$regex: regex}}).limit(5);
    if(files.length > 0) {
        res.json(files);
    }else {
        res.sendStatus(404);
    }
});

module.exports = router;
