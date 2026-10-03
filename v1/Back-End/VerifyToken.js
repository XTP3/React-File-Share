const Config = require('./Config.json');
const jwt = require('jsonwebtoken');

const secretKey = Config.JWT_SECRET_KEY;

function verifyToken(req, res, next) {
    const bearerHeader = req.headers['authorization'];

    if(typeof bearerHeader !== 'undefined') {
        const bearer = bearerHeader.split(' ');
        const bearerToken = bearer[1];
        jwt.verify(bearerToken, secretKey, async (err, authData) => {
            if(err) {
                res.sendStatus(401);

            }else {
                req.token = bearerToken;
                req.uuid = authData.uniqueID;
                next();
            }

        });

    } else {
        res.sendStatus(400);
    }
}

module.exports = { verifyToken };