var request = require('request');
var nodemailer = require("nodemailer");
var os = require('os');
var fs = require('fs');
var moment = require('moment');

var CHECK_INTERVAL_MIN = 120;
var EMAIL_ALERT_ENABLED = 'no';
var ALWAYS_ALERT_AFTER_START = 'no';
var TAG_REMOVAL_REGEX = /<[^>]*>/g;

// Build the post string from an object
var post_data = {
    lang : '',
    _page: '_target0',
    app : '',
    identifierType: '1',
    identifier : undefined,
    surname : undefined,
    dateOfBirth : undefined,
    countryOfBirth : undefined,
    _submit : 'Continue'
};
// setup e-mail data with unicode symbols
var mailOptions = {
    from: 'Immigration Tracker', // sender address
    to: undefined, // list of receivers
    subject: 'Permanent Resident Application Status Update', // Subject line
    text: ''
};
var senderGmailInfo = {
    service: 'Gmail',
    auth: {
        user: undefined,
        pass: undefined
    }
};
var req_options_general = {
    url : 'https://services3.cic.gc.ca/ecas/authenticate.do',
    method : 'POST',
    form : post_data,
    jar : true,
    followAllRedirects : true 
};

var numItems = 0,
    lastStatus = "";

process.on('uncaughtException', function (err) {
    log('An error was found, the program will end.');
    log('Please check your config file and make sure all inputs are correct.');
});

fs.readFile('config.txt', 'utf8', function(err, data) {
    if(err) {
        return log('Error reading the config file.');
    }
    readConfigInfo(data);
    readClientInfo(data);
    // check if client info is valid
    if(!isClientInfoValid()) {
        return log('Invalid CIC client information.');
    }
    readEmailInfo(data);
    // check if email info is valid
    if(!isEmailInfoValid()) {
        return log('Invalid Email client information.');
    }
    checkApplicationStatus();
    setInterval(checkApplicationStatus, CHECK_INTERVAL_MIN * 1000 * 60);
});

function readConfigInfo(data) {
    var lines = data.toString().replace(/\r/g, '').split('\n');
    for(var i = 0; i < lines.length; i++) {
        if(lines[i].indexOf('#') !== 0 && lines[i].indexOf('=') !== -1) {
        var key = lines[i].split('=');
            if(key[0] === 'Check Interval (Minutes)' && key[1] > CHECK_INTERVAL_MIN) {
                CHECK_INTERVAL_MIN = key[1];
            } else if(key[0] === 'Enable Email Alert') {
                EMAIL_ALERT_ENABLED = key[1].toLowerCase();
            } else if(key[0] === 'Always Send Alert After Start') {
                ALWAYS_ALERT_AFTER_START = key[1].toLowerCase();
            }
        }
    }
    log('Check interval set to [' + CHECK_INTERVAL_MIN + '] minutes.');
    log('Use Email alert: ' + EMAIL_ALERT_ENABLED + '.');
    log('Always send alert after start: ' + ALWAYS_ALERT_AFTER_START + '.');
}

function readClientInfo(data) {
    var lines = data.toString().replace(/\r/g, '').split('\n');
    for(var i = 0; i < lines.length; i++) {
        if(lines[i].indexOf('#') !== 0 && lines[i].indexOf('=') !== -1) {
        var key = lines[i].split('=');
            if(key[0] === 'UCI') {
                post_data.identifier = key[1];
            } else if(key[0] === 'Surname') {
                post_data.surname = key[1];
            } else if(key[0] === 'Date Of Birth (YYYY-MM-DD)') {
                post_data.dateOfBirth = key[1];
            } else if(key[0] === 'Country Of Birth') {
                post_data.countryOfBirth = key[1];
            }
        }
    }
}

function isClientInfoValid() {
    return (post_data.identifier && post_data.surname && post_data.dateOfBirth && post_data.countryOfBirth);
}

function readEmailInfo(data) {
    var lines = data.toString().replace(/\r/g, '').split('\n');
    for(var i = 0; i < lines.length; i++) {
        if(lines[i].indexOf('#') !== 0 && lines[i].indexOf('=') !== -1) {
        var key = lines[i].split('=');
            if(key[0] === 'Send To') {
                mailOptions.to = key[1];
            } else if(key[0] === 'Subject') {
                mailOptions.subject = key[1];
            } else if(key[0] === 'Gmail Address') {
                senderGmailInfo.auth.user = key[1];
            } else if(key[0] === 'Gmail Password') {
                senderGmailInfo.auth.pass = key[1];
            }
        }
    }
}

function isEmailInfoValid() {
    return (mailOptions.to && mailOptions.subject && senderGmailInfo.auth.user && senderGmailInfo.auth.pass);
}

function getResultStr(firstName, lastName, applicantHeader, statusHeader, status, items) {
    var result = '─ ' + applicantHeader + ' : ['+ firstName + ' ' + lastName +']' + os.EOL;
    result += '─ ' + statusHeader + ' : ['+ status +']' + os.EOL;
    result += '─ ' + 'Status Details:' + os.EOL;
    for(var i = 0; i < items.length; i++) {
        if(i < items.length - 1) {
            result += '├─ ';
        } else {
            result += '└─ ';
        }
        result += items[i].replace(/<(\/?)li>/g, '') + os.EOL;
    }
    return result;
}

function checkApplicationStatus() {
    log('Starting to check application status...Next check will be after [' + CHECK_INTERVAL_MIN + '] minutes.')
    request(req_options_general, function (error, response, body) {
        if (!error && response.statusCode === 200) {
            // get headers
            var header = body.match(/<thead>[\w\W]*<\/thead>/)[0].match(/<th.*>(.+)<\/th>/g);
            var applicantHeader = header[0].replace(TAG_REMOVAL_REGEX, '');
            var statusHeader = header[1].replace(TAG_REMOVAL_REGEX, '');
            // get application info
            var info = body.match(/<tbody>[\w\W]*<\/tbody>/)[0].replace(/<\/?\w+>/g, '').match(/[^\t^\n]+/g);
            var firstName = info[1];
            var lastName = info[2];
            var detailLink = info[3].match(/"(.*?)"/)[0].replace(/"/g, '').replace(/&amp;/g, '&');
            var status = info[4];
            var req_options_detail = {
                'url' : 'https://services3.cic.gc.ca/ecas/' + detailLink,
                'method' : 'GET',
                'jar' : true,
                'followAllRedirects' : true
            };
            request(req_options_detail, function (error2, response2, body2) {
                if (!error2 && response2.statusCode == 200) {
                    var items = body2.match(/<li>(.+)\.<\/li>/g);
                    var result = getResultStr(firstName, lastName, applicantHeader, statusHeader, status, items);
                    log(result);
                    if(numItems === 0 && ALWAYS_ALERT_AFTER_START === 'no') {
                        // initial item length
                        numItems = items.length;
                        log('First time check without alert. There are [' + numItems + '] items.');
                    }
                    if(items.length > numItems || status !== lastStatus) {
                        // add number
                        numItems = items.length;
                        lastStatus = status;
                        log('Status or items changed. Status become [' + lastStatus + '], items count [' + numItems + ']. ');
                        // send email notification
                        if(EMAIL_ALERT_ENABLED === 'yes') {
                            log('Now sending alert email.');
                            mailOptions.text = result;
                            // create reusable transport method (opens pool of SMTP connections)
                            var smtpTransport = nodemailer.createTransport('SMTP', senderGmailInfo);
                            smtpTransport.sendMail(mailOptions, function(error, response) {
                                if(error){
                                    log(error);
                                }else{
                                    log("Email alert sent: " + response.message);
                                }
                                smtpTransport.close();
                            });
                        } else {
                            log('!!!!!!!!!!!!!!!!!! ALERT FROM CONSOLE !!!!!!!!!!!!!!!!!!');
                        }
                    }
                }
            });
        }
    });
}

function log(str) {
    console.log('[' + moment().format('MM-DD HH:mm') + '] ' + str);
}