const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
    uniqueID: {
        type: String,
        required: true
    },
    fileName: {
        type: String,
        required: true
    },
    fileSize: {
        type: Number,
        required: true
    },
    fileType: {
        type: String,
        required: true
    },
    uploaderID: {
        type: String,
        required: true
    },
    timeOfUpload: {
        type: Number,
        required: true,
        default: Date.now()
    },
    timeOfUploadDate: {
        type: String,
        required: false
    }
});

module.exports = mongoose.model('File', fileSchema);