const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    uniqueID: {
        type: String,
        required: true
    },
    username: {
        type: String,
        required: true
    },
    password: {
        type: String,
        required: true
    },
    timeOfCreation: {
        type: Number,
        required: true,
        default: Date.now()
    },
    timeOfLastLogin: {
        type: Date,
        required: false
    },
    ipAddress: {
        type: String,
        required: false
    },
    authorizationLevel: {
        type: Number,
        required: false 
    }
});

module.exports = mongoose.model('User', userSchema);