const express = require('express'); // Express web server framework
const fs = require('fs'); // file system
const AWS = require('aws-sdk'); // AWS SDK
const admin = require('firebase-admin'); // Firebase Admin SDK
const BodyParser = require('body-parser'); // for parsing JSON
const uuid = require('uuid'); // for generating unique file names
const dotenv = require('dotenv'); // for loading environment variables

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

dotenv.config(); // load environment variables

// configure AWS SDK
AWS.config.update({
    region: process.env.AWS_REGION, // region of your bucket
}); // update AWS config

const s3 = new AWS.S3({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID, // access key
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, // secret access key
    region: process.env.AWS_REGION, // region of your bucket
    signatureVersion: 'v4', // signature version
}); // create S3 instance

const textract = new AWS.Textract({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID, // access key
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY, // secret access key
    region: process.env.AWS_REGION, // region of your bucket
    signatureVersion: 'v4', // signature version
}); // create Textract instance

const uploadAndAnalyse = async (req, res) => {
    try {
        const fileName = `${uuid.v4()}.jpg`; // generate unique file name
        const image = Buffer.from(req.body.photo, 'base64'); // convert base64 to buffer
        const s3Params = {
            Bucket: process.env.S3_BUCKET_NAME, // bucket name
            Key: fileName, // file name
            Body: image, // file content
            ContentEncoding: 'base64', // content encoding
            ContentType: 'image/jpg', // content type
        }; // params for S3 upload

        s3.upload(s3Params, async (err, data) => {
            if (err) {
                console.error("Error uploading to S3: ", err); // log error
            } else {
                const s3ObjectParams = {
                    Bucket: process.env.S3_BUCKET_NAME, // bucket name
                    Key: fileName, // file name
                }; // params for S3 object
        
                s3.getObject(s3ObjectParams, (err, data) => {
                    if (err) {
                        console.error("Error getting object from S3: ", err); // log error
                    } else {
                        const textractParams = {
                            Document: {
                                Bytes: data.Body, // S3 object content
                            }
                        }; // params for Textract
        
                        textract.analyzeExpense(textractParams, (err, jdata) => {
                            if (err) {
                                console.error("Error analysing expense: ", err); // log error
                            } else {
                                // const jdata = JSON.parse(data);
                                var summaryFields = []; // array of summary fields
                                var lineItems = []; // array of line items
                                jdata.ExpenseDocuments.forEach((expenseDocument) => {
                                    expenseDocument.SummaryFields.forEach((summaryField) => {
                                        var keyMap = {};
                                        keyMap["type"] = summaryField.Type.Text; // type of field
                                        keyMap["value"] = summaryField.ValueDetection.Text; // value of field
                                        summaryFields.push(keyMap);
                                    }); // summary fields
                                    // Important Note: VENDOR_NAME and TOTAL are the needed fields
                                    
                                    expenseDocument.LineItemGroups.forEach((lineItemGroup) => {
                                        lineItemGroup.LineItems.forEach((lineItem) => {
                                            var lineItemMap = {}; // map of line item
                                            lineItem.LineItemExpenseFields.forEach((lineItemExpenseField) => {
                                                if (lineItemExpenseField.Type.Text == "ITEM") {
                                                    lineItemMap["item"] = lineItemExpenseField.ValueDetection.Text; // name of item
                                                } else if (lineItemExpenseField.Type.Text == "PRICE") {
                                                    lineItemMap["price"] = lineItemExpenseField.ValueDetection.Text; // price of item
                                                } else if (lineItemExpenseField.Type.Text == "QUANTITY") {
                                                    lineItemMap["quantity"] = lineItemExpenseField.ValueDetection.Text; // quantity of item
                                                }
                                            }); // line item expense fields
                                            lineItems.push(lineItemMap); // push line item to array
                                        }); // line items
                                    }); // line item groups

                                    // Important Note: Every Line Item has Name, Quantity and Price as keys
                                });

                                console.log(JSON.stringify(summaryFields));
                                console.log(JSON.stringify(lineItems));
                                res.status(200).json(summaryFields); // send result to client
                            }
                        }); // analyse expense
                    }
                }); // get object from S3
            }
        }); // upload to S3

    } catch (error) {
        console.error("Error connecting to S3: ", error); // log error
        throw error;
    }
} // uploadAndAnalyse

app.post('/uploadAndAnalyse', (req, res) => {
    return uploadAndAnalyse(req, res);
}); // POST /uploadAndAnalyse

// pm2 --name monke start npm -- start
