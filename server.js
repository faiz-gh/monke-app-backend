const express = require('express'); // Express web server framework
const aws = require('aws-sdk'); // AWS SDK
const bodyParser = require('body-parser'); // for parsing JSON
const uuid = require('uuid'); // for generating unique file names
const fs = require('fs'); // for reading files

const app = express(); // create express app

// configure express app
app.use(BodyParser.json({
    limit: '50mb',
})); // parse JSON
app.use(BodyParser.urlencoded({
    limit: '50mb',
    extended: false,
})); // parse URL-encoded bodies

const PORT = process.env.PORT || 3000; // port to listen on
app.listen(PORT, () => console.log(`Listening on port ${PORT}`)); // start server

