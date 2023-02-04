const express = require('express'); // Express web server framework
const AWS = require('aws-sdk'); // AWS SDK
const admin = require('firebase-admin'); // Firebase Admin SDK
const serviceAccount = require('./serviceAccount.json'); // service account key
const BodyParser = require('body-parser'); // for parsing JSON
const uuid = require('uuid'); // for generating unique file names
const dotenv = require('dotenv'); // for loading environment variables

// configure Firebase Admin SDK
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount), // service account key
}); // initialize Firebase Admin SDK
const db = admin.firestore(); // get Firestore instance
admin.firestore().settings({ignoreUndefinedProperties:true}); // ignore undefined properties

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
        const uuidGenerator = uuid.v4(); // generate unique file name
        const fileName = `${uuidGenerator}.jpg`; // generate unique file name
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
                                var summaryFields = {"vendor_name": "N/A", "total": 0}; // array of summary fields
                                var lineItems = []; // array of line items
                                var typeCount = 0; // count of types
                                var valueCount = 0; // count of values
                                jdata.ExpenseDocuments.forEach((expenseDocument) => {
                                    expenseDocument.SummaryFields.forEach((summaryField) => {
                                        if (summaryField.Type.Text == "VENDOR_NAME"){
                                            summaryFields["vendor_name"] = summaryField.ValueDetection.Text.replace(/\n/g, ' '); // value of field
                                            if (typeCount == 0){
                                                typeCount++; // increment type count
                                            }
                                        } else if (summaryField.Type.Text == "TOTAL"){
                                            summaryFields["total"] = summaryField.ValueDetection.Text.replace(/\n/g, ' '); // value of field
                                            if (valueCount == 0){
                                                valueCount++; // increment value count
                                            }
                                        }
                                    }); // summary fields
                                    // Important Note: VENDOR_NAME and TOTAL are the needed fields
                                    
                                    expenseDocument.LineItemGroups.forEach((lineItemGroup) => {
                                        lineItemGroup.LineItems.forEach((lineItem) => {
                                            var lineItemMap = {}; // map of line item
                                            lineItem.LineItemExpenseFields.forEach((lineItemExpenseField) => {
                                                if (lineItemExpenseField.Type.Text == "ITEM") {
                                                    lineItemMap["item"] = lineItemExpenseField.ValueDetection.Text.replace(/\n/g, ' '); // name of item
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
                                }); // expense documents

                                console.log(JSON.stringify(summaryFields)); // log summary fields
                                console.log(JSON.stringify(lineItems)); // log line items

                                try {
                                    var docname = summaryFields.vendor_name + " - " + new Date().toISOString(); // generate unique document name
                                    db.collection('bills').doc(docname).set({
                                        vendor_name: summaryFields.vendor_name,
                                        items: lineItems,
                                        total: summaryFields.total,
                                        date: new Date().toISOString(),
                                    }).then((docRef) => {
                                        console.log("Document written with ID: ", fileName); // log success
                                    }).catch((error) => {
                                        console.error("Error adding document: ", error); // log error
                                    }); // add bill to database

                                    // filtering discount value
                                    const number = parseFloat(summaryFields.total.match(/[+-]?\d+(\.\d+)?/g)[0]) * 0.1; // calculate discount
                                    const discount = Math.round((number + Number.EPSILON) * 100) / 100; // rounding off to 2 decimal points

				                    db.collection('data').doc('stats').update({
					                    count: admin.firestore.FieldValue.increment(discount), // increment discount
                                    }).then((docRef) => {
                                        console.log("Document written with ID: ", docRef.id); // log success
                                    }).catch((error) => {
                                        console.error("Error adding document: ", error); // log error
                                    }); // update total

                                } catch (err){
                                    throw("Error uploading to the firestore: " , err);
                                }
                                 // add to firestore
                                res.status(200).send("Success"); // send success
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
