"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const socketIo = require("socket.io");
const Path = require("path");
const Os = require("os");
const Http = require("http");
const Fs = require("fs");
const Async = require("async");
const Util = require("util");
const Https = require("https");
const Crypto1 = require("crypto");
const Net = require("net");
const Imap = require("./imap");
const freePort = require("portastic");
const openpgp = require('openpgp');
const Express = require('express');
const cookieParser = require('cookie-parser');
const Nodemailer = require('nodemailer');
const Uuid = require('node-uuid');
const { remote } = require('electron');
const DEBUG = true;
const QTGateFolder = Path.join(Os.homedir(), '.QTGate');
const QTGateSignKeyID = /3acbe3cbd3c1caa9/i;
const configPath = Path.join(QTGateFolder, 'config.json');
const ErrorLogFile = Path.join(QTGateFolder, 'systemError.log');
const imapDataFileName = Path.join(QTGateFolder, 'imapData.pem');
const myIpServerUrl = ['https://ipinfo.io/ip', 'https://icanhazip.com/', 'https://diagnostic.opendns.com/myip', 'http://ipecho.net/plain', 'https://www.trackip.net/ip'];
const keyServer = 'https://pgp.mit.edu';
const QTGatePongReplyTime = 1000 * 30;
const version = remote.app.getVersion();
const createWindow = () => {
    remote.getCurrentWindow().rendererCreateWindow();
};
const saveLog = (log) => {
    const data = `${new Date().toUTCString()}: ${log}\r\n`;
    Fs.appendFile(ErrorLogFile, data, { encoding: 'utf8' }, err => { });
};
const findPort = (port, CallBack) => {
    return freePort.test(port).then(isOpen => {
        if (isOpen)
            return CallBack(null, port);
        ++port;
        return findPort(port, CallBack);
    });
};
const doUrl = (url, CallBack) => {
    let ret = '';
    if (/^https/.test(url))
        return Https.get(url, res => {
            res.on('data', (data) => {
                ret += data.toString('utf8');
            });
            res.once('end', () => {
                return CallBack(null, ret);
            });
        }).once('error', err => {
            console.log('on err ');
            return CallBack(err);
        });
    return Http.get(url, res => {
        res.on('data', (data) => {
            ret += data.toString('utf8');
        });
        res.once('end', () => {
            return CallBack(null, ret);
        });
    }).once('error', err => {
        console.log('on err ');
        return CallBack(err);
    });
};
const myIpServer = (CallBack) => {
    let ret = false;
    Async.each(myIpServerUrl, (n, next) => {
        doUrl(n, (err, data) => {
            if (err) {
                return next();
            }
            if (!ret) {
                ret = true;
                return CallBack(null, data);
            }
        });
    }, () => {
        return CallBack(new Error(''));
    });
};
const getQTGateSign = (_key) => {
    const key = openpgp.key.readArmored(_key).keys;
    if (!key || !key.length)
        return false;
    const user = key[0].users;
    if (!user || !user.length || !user[0].otherCertifications || !user[0].otherCertifications.length) {
        return false;
    }
    const signID = user[0].otherCertifications[0].issuerKeyId.toHex();
    return QTGateSignKeyID.test(signID);
};
const KeyPairDeleteKeyDetail = (keyPair, passwordOK) => {
    const ret = {
        nikeName: keyPair.nikeName,
        email: keyPair.email,
        keyLength: keyPair.keyLength,
        createDate: keyPair.createDate,
        passwordOK: passwordOK,
        verified: keyPair.verified,
        publicKeyID: keyPair.publicKeyID
    };
    return ret;
};
const emitConfig = (config, passwordOK) => {
    const ret = {
        keypair: KeyPairDeleteKeyDetail(config.keypair, passwordOK),
        firstRun: config.firstRun,
        alreadyInit: config.alreadyInit,
        newVerReady: config.newVerReady,
        version: config.version,
        multiLogin: config.multiLogin,
        freeUser: config.freeUser,
        account: config.keypair.email,
        QTGateConnectImapUuid: config.QTGateConnectImapUuid,
        serverGlobalIpAddress: config.serverGlobalIpAddress
    };
    return ret;
};
const getBitLength = (key) => {
    let size = 0;
    if (key.primaryKey.mpi.length) {
        size = (key.primaryKey.mpi[0].byteLength() * 8);
    }
    return size.toString();
};
const InitKeyPair = () => {
    const keyPair = {
        publicKey: null,
        privateKey: null,
        keyLength: null,
        nikeName: null,
        createDate: null,
        email: null,
        passwordOK: false,
        verified: false,
        publicKeyID: null
    };
    return keyPair;
};
const getKeyFingerprint = (key) => {
    return key.primaryKey.fingerprint.toUpperCase();
};
const getKeyId = (key) => {
    const id = getKeyFingerprint(key);
    return id.substr(id.length - 8);
};
const getKeyUserInfo = (UserID, keypair) => {
    if (UserID && UserID.length) {
        const temp = UserID.split(' <');
        const temp1 = temp[0].split(' (');
        const temp2 = temp1.length > 1
            ? temp1[1].split('||')
            : '';
        keypair.email = temp.length > 1
            ? temp[1].slice(0, temp[1].length - 1)
            : '';
        keypair.nikeName = temp1[0];
    }
};
const getKeyPairInfo = (publicKey, privateKey, password, CallBack) => {
    const _privateKey = openpgp.key.readArmored(privateKey);
    const _publicKey = openpgp.key.readArmored(publicKey);
    if (_privateKey.err || _publicKey.err) {
        return CallBack(new Error('key pair error'));
    }
    const privateKey1 = _privateKey.keys[0];
    const publicKey1 = _publicKey.keys;
    const ret = {
        publicKey: publicKey,
        privateKey: privateKey,
        keyLength: getBitLength(privateKey1),
        nikeName: '',
        createDate: new Date(privateKey1.primaryKey.created).toLocaleString(),
        email: '',
        passwordOK: false,
        verified: getQTGateSign(publicKey),
        publicKeyID: getKeyId(publicKey1[0])
    };
    const user = privateKey1.users;
    if (user && user.length) {
        getKeyUserInfo(user[0].userId.userid, ret);
    }
    if (!password || !privateKey1.decrypt(password))
        return CallBack(null, ret);
    ret.passwordOK = true;
    return CallBack(null, ret);
};
const InitConfig = (first, version) => {
    const ret = {
        firstRun: first,
        alreadyInit: false,
        multiLogin: false,
        version: version,
        newVersion: null,
        newVerReady: false,
        keypair: InitKeyPair(),
        salt: Crypto1.randomBytes(64),
        iterations: 2000 + Math.round(Math.random() * 2000),
        keylen: Math.round(16 + Math.random() * 30),
        digest: 'sha512',
        freeUser: true,
        account: null,
        QTGateConnectImapUuid: null,
        serverGlobalIpAddress: null
    };
    return ret;
};
const checkKey = (keyID, CallBack) => {
    const hkp = new openpgp.HKP(keyServer);
    const options = {
        query: keyID
    };
    hkp.lookup(options).then(key => {
        if (key) {
            return CallBack(null, key);
        }
        return CallBack(null, null);
    }).catch(err => {
        CallBack(err);
    });
};
const readQTGatePublicKey = (CallBack) => {
    const fileName = Path.join(__dirname, 'info@QTGate.com.pem');
    Fs.readFile(fileName, 'utf8', CallBack);
};
const deCryptoWithKey = (data, publicKey, privateKey, password, CallBack) => {
    const options = {
        message: openpgp.message.readArmored(data),
        publicKeys: openpgp.key.readArmored(publicKey).keys,
        privateKey: openpgp.key.readArmored(privateKey).keys[0]
    };
    if (!options.privateKey.decrypt(password)) {
        return CallBack(new Error('saveImapData key password error!'));
    }
    openpgp.decrypt(options).then(plaintext => {
        return CallBack(null, plaintext.data);
    }).catch(err => {
        return CallBack(err);
    });
};
const encryptWithKey = (data, targetKey, privateKey, password, CallBack) => {
    if (!data || !data.length || !targetKey || !targetKey.length || !privateKey || !privateKey.length) {
        return CallBack(new Error('unknow format!'));
    }
    const publicKeys = openpgp.key.readArmored(targetKey).keys;
    const privateKeys = openpgp.key.readArmored(privateKey).keys[0];
    if (!privateKeys.decrypt(password))
        return CallBack(new Error('private key password!'));
    const option = {
        data: data,
        publicKeys: publicKeys,
        privateKeys: privateKeys
    };
    openpgp.encrypt(option).then(m => {
        CallBack(null, m.data);
    }).catch(err => {
        CallBack(err);
    });
};
const RendererProcess = (name, data, CallBack) => {
    let win = new remote.BrowserWindow({ show: false });
    win.setIgnoreMouseEvents(true);
    //win.webContents.openDevTools()
    //win.maximize ()
    win.once('first', () => {
        win.once('firstCallBackFinished', returnData => {
            win.close();
            win = null;
            CallBack(returnData);
        });
        win.emit('firstCallBack', data);
    });
    win.loadURL(`file://${Path.join(__dirname, name + '.html')}`);
};
class localServer {
    constructor(version, port) {
        this.version = version;
        this.port = port;
        this.ex_app = null;
        this.socketServer = null;
        this.httpServer = null;
        this.config = null;
        this.newKeyRequest = null;
        this.mainSocket = null;
        this.resert = false;
        this.downloading = false;
        this.QTClass = null;
        this.newRelease = null;
        this.savedPasswrod = '';
        this.imapDataPool = [];
        this.CreateKeyPairProcess = null;
        this.QTGateConnectImap = -1;
        this.sendRequestToQTGate = false;
        this.qtGateConnectEmitData = null;
        this.bufferPassword = null;
        this.ex_app = Express();
        this.ex_app.set('views', Path.join(__dirname, 'views'));
        this.ex_app.set('view engine', 'pug');
        this.ex_app.use(cookieParser());
        this.ex_app.use(require('stylus').middleware(Path.join(__dirname, 'public')));
        this.ex_app.use(Express.static(QTGateFolder));
        this.ex_app.use(Express.static(Path.join(__dirname, 'public')));
        this.ex_app.get('/', (req, res) => {
            res.render('home', { title: 'home' });
        });
        this.ex_app.get('/doingUpdate', (req, res) => {
            const { ver } = req.query;
            this.config.newVersion = ver;
            this.config.newVerReady = true;
            this.saveConfig();
            saveLog(`this.ex_app.get ( '/doingUpdate' ) get ver = [${req.query}]`);
            return res.end();
        });
        this.ex_app.get('/update/mac', (req, res) => {
            if (!this.config.newVerReady) {
                return res.status(204).end();
            }
            const { ver } = req.query;
            return res.json({ url: `http://127.0.0.1:3000/latest/${ver}/qtgate-${ver.substr(1)}-mac.zip` });
        });
        this.ex_app.get('/linuxUpdate', (req, res) => {
            res.render('home/linuxUpdate', req.query);
        });
        this.ex_app.get('/checkUpdate', (req, res) => {
            res.render('home/checkUpdate', req.query);
        });
        this.ex_app.use((req, res, next) => {
            saveLog('ex_app.use 404:' + req.url);
            return res.status(404).send("Sorry can't find that!");
        });
        this.httpServer = Http.createServer(this.ex_app);
        this.socketServer = socketIo(this.httpServer);
        this.socketServer.on('connection', socket => {
            this.socketConnectListen(socket);
        });
        this.httpServer.listen(port, '127.0.0.1');
        this.checkConfig();
        saveLog(`Version: ${process.version}`);
    }
    saveConfig() {
        Fs.writeFile(configPath, JSON.stringify(this.config), { encoding: 'utf8' }, err => {
            if (err)
                return saveLog(`localServer->saveConfig ERROR: ` + err.message);
        });
    }
    saveImapData() {
        if (!this.imapDataPool || !this.imapDataPool.length) {
            return Fs.unlink(imapDataFileName, err => { });
        }
        const _data = JSON.stringify(this.imapDataPool);
        const options = {
            data: _data,
            publicKeys: openpgp.key.readArmored(this.config.keypair.publicKey).keys,
            privateKeys: openpgp.key.readArmored(this.config.keypair.privateKey).keys
        };
        Async.waterfall([
            (next) => this.getPbkdf2(this.savedPasswrod, next),
            (data, next) => {
                if (!options.privateKeys[0].decrypt(data.toString('hex'))) {
                    return next(new Error('saveImapData key password error!'));
                }
                openpgp.encrypt(options).then(ciphertext => {
                    Fs.writeFile(imapDataFileName, ciphertext.data, { encoding: 'utf8' }, next);
                }).catch(err => {
                    return next(err);
                });
            }
        ], err => {
            if (err)
                saveLog(`saveImapData error: ${JSON.stringify(err)}`);
        });
    }
    pgpDecrypt(text, CallBack) {
        if (!text || !text.length) {
            return CallBack(new Error('no text'));
        }
        const options = {
            message: null,
            publicKeys: openpgp.key.readArmored(this.config.keypair.publicKey).keys,
            privateKey: openpgp.key.readArmored(this.config.keypair.privateKey).keys[0]
        };
        Async.waterfall([
            (next) => this.getPbkdf2(this.savedPasswrod, next),
            (data, next) => {
                if (!options.privateKey.decrypt(data.toString('hex'))) {
                    return next(new Error('saveImapData key password error!'));
                }
                this.bufferPassword = data.toString('hex');
                options.message = openpgp.message.readArmored(text);
                openpgp.decrypt(options).then(plaintext => {
                    try {
                        const data = JSON.parse(plaintext.data);
                        return next(null, data);
                    }
                    catch (e) {
                        console.log(plaintext);
                        return next(new Error('readImapData try SON.parse ( plaintext.data ) catch ERROR:' + e.message));
                    }
                }).catch(err => {
                    next(err);
                });
            }
        ], (err, data) => {
            if (err) {
                saveLog(`readImapData got error: ${Util.inspect(options)}, err:${Util.inspect(err)}`);
                return CallBack(err);
            }
            return CallBack(null, data);
        });
    }
    pgpEncrypt(text, CallBack) {
        console.log(`local server pgpEncrypt `);
        if (!text || !text.length) {
            return CallBack(new Error('no text'));
        }
        const options = {
            data: text,
            publicKeys: openpgp.key.readArmored(this.config.keypair.publicKey).keys,
            privateKeys: openpgp.key.readArmored(this.config.keypair.privateKey).keys
        };
        Async.waterfall([
            (next) => this.getPbkdf2(this.savedPasswrod, next),
            (data, next) => {
                if (!options.privateKeys[0].decrypt(data.toString('hex'))) {
                    return next(new Error('saveImapData key password error!'));
                }
                openpgp.encrypt(options).then(ciphertext => {
                    return next(null, ciphertext.data);
                }).catch(err => {
                    return next(err);
                });
            }
        ], (err, data) => {
            if (err) {
                saveLog(`saveImapData error: ${JSON.stringify(err)}`);
                return CallBack(err);
            }
            return CallBack(null, data);
        });
    }
    readImapData(CallBack) {
        if (!this.savedPasswrod || !this.savedPasswrod.length || !this.config || !this.config.keypair || !this.config.keypair.createDate)
            return CallBack(new Error('readImapData no password or keypair data error!'));
        const options = {
            message: null,
            publicKeys: openpgp.key.readArmored(this.config.keypair.publicKey).keys,
            privateKey: openpgp.key.readArmored(this.config.keypair.privateKey).keys[0]
        };
        Async.waterfall([
            (next) => {
                Fs.access(imapDataFileName, next);
            },
            (next) => this.getPbkdf2(this.savedPasswrod, next),
            (data, next) => {
                if (!options.privateKey.decrypt(data.toString('hex'))) {
                    return next(new Error('saveImapData key password error!'));
                }
                Fs.readFile(imapDataFileName, 'utf8', next);
            },
            (data, next) => {
                options.message = openpgp.message.readArmored(data.toString());
                openpgp.decrypt(options).then(plaintext => {
                    try {
                        const data = JSON.parse(plaintext.data);
                        return next(null, data);
                    }
                    catch (e) {
                        return next(new Error('readImapData try JSON.parse ( plaintext.data ) catch ERROR:' + e.message));
                    }
                }).catch(err => {
                    next(err);
                });
            }
        ], (err, data) => {
            if (err) {
                saveLog(`readImapData got error: ${Util.inspect(options)}, err:${Util.inspect(err)}`);
                return CallBack(err);
            }
            this.imapDataPool = data;
            return CallBack();
        });
    }
    listenAfterPassword(socket) {
        saveLog('listen listenAfterPassword!');
        socket.on('deleteAImapData', (email) => {
            DEBUG ? saveLog('socket.on deleteAImapData' + ` [${email}] total data [${this.imapDataPool.length}]`) : null;
            const index = this.imapDataPool.findIndex(n => { return n.email === email; });
            if (index === -1)
                return;
            this.imapDataPool.splice(index, 1);
            DEBUG ? saveLog('socket.on deleteAImapData find data' + `[${index}] total data [${this.imapDataPool.length}]`) : null;
            this.saveImapData();
        });
        socket.on('startCheckImap', (id, imapData, CallBack) => {
            console.log(`on startCheckImap `, imapData);
            if (!id || !id.length || !imapData || !Object.keys(imapData).length) {
                saveLog(`socket.on startCheckImap but data format is error! id:[${id}] imapData:[${Util.inspect(imapData)}]`);
                return CallBack(1);
            }
            if (this.imapDataPool.length) {
                const index = this.imapDataPool.findIndex(n => { return n.email === imapData.email && n.uuid !== imapData.uuid; });
                if (index > -1) {
                    return CallBack(10);
                }
            }
            return myIpServer((err, ip) => {
                if (err || !ip) {
                    saveLog('startCheckImap isOnline false!');
                    return CallBack(2);
                }
                CallBack(null);
                return this.doingCheck(id, imapData, socket);
            });
        });
        socket.on('deleteImapAccount', uuid => {
            if (!uuid && !uuid.length) {
                return saveLog(`deleteImapAccount have not uuid!`);
            }
            const index = this.imapDataPool.findIndex(n => { return n.uuid === uuid; });
            if (index < 0 || !this.imapDataPool[index].canDoDelete) {
                return saveLog(`deleteImapAccount have not uuid! or canDoDelete == false`);
            }
            saveLog(`delete imap uuid = [${uuid}]`);
            this.imapDataPool.splice(index, 1);
            this.saveImapData();
            socket.emit('ImapData', this.imapDataPool);
        });
        socket.on('getAvaliableRegion', CallBack => {
            const com = {
                command: 'getAvaliableRegion',
                Args: [],
                error: null,
                requestSerial: Crypto1.randomBytes(8).toString('hex')
            };
            console.log(`socket on getAvaliableRegion doing getAvaliableRegion!`);
            return this.QTClass.request(com, (err, res) => {
                console.log(`get server callback getAvaliableRegion`, res.Args);
                CallBack(res.Args);
            });
        });
        socket.on('checkActiveEmailSubmit', (text) => {
            if (!text || !text.length || !/^-----BEGIN PGP MESSAGE-----(\r)?\n(.+)((\r)?\n)/.test(text) || !/(\r)?\n-----END PGP MESSAGE-----((\r)?\n)?/.test(text)) {
                socket.emit('checkActiveEmailError', 0);
                return saveLog(`checkActiveEmailSubmit, no text.length !`);
            }
            if (!this.QTClass) {
                socket.emit('checkActiveEmailError', 2);
                return saveLog(`checkActiveEmailSubmit, have no this.QTClass!`);
            }
            this.pgpDecrypt(text, (err, data) => {
                if (err) {
                    socket.emit('checkActiveEmailError', 1);
                    return saveLog(`checkActiveEmailSubmit ERROR:[${err}]`);
                }
                const com = {
                    command: 'activePassword',
                    Args: [data],
                    error: null,
                    requestSerial: Crypto1.randomBytes(8).toString('hex')
                };
                this.QTClass.request(com, (err, res) => {
                    if (err) {
                        return socket.emit('qtGateConnect', 5);
                    }
                    if (res.error > -1) {
                        console.log(`this.QTClass.request call back ERROR!`, res.error);
                        return socket.emit('checkActiveEmailError', res.error);
                    }
                    if (res.Args && res.Args.length) {
                        const key = Buffer.from(res.Args[0], 'base64').toString();
                        this.config.keypair.publicKey = key;
                        this.config.keypair.verified = getQTGateSign(key);
                        this.saveConfig();
                        socket.emit('newKeyPairCallBack', this.config.keypair);
                        this.qtGateConnectEmitData.qtGateConnecting = 2;
                        this.qtGateConnectEmitData.error = -1;
                        return socket.emit('qtGateConnect', this.qtGateConnectEmitData);
                    }
                });
                return socket.emit('checkActiveEmailError', null);
            });
        });
        socket.on('connectQTGate', uuid => {
            console.log(`socket.on ( 'connectQTGate', uuid[${uuid}]`);
            const index = this.imapDataPool.findIndex(n => { return n.uuid === uuid; });
            if (index < 0)
                return;
            this.imapDataPool[index].sendToQTGate = true;
            this.emitQTGateToClient(socket, uuid);
        });
        socket.on('QTGateGatewayConnectRequest', (cmd, CallBack) => {
            const com = {
                command: 'connectRequest',
                Args: [cmd],
                error: null,
                requestSerial: Crypto1.randomBytes(8).toString('hex')
            };
            console.log(Util.inspect(cmd, { depth: 4, colors: true }));
            const transfer = {
                productionPackage: 'free',
                usedMonthlyOverTransfer: 1073741824,
                account: 'info@qtgate.com',
                availableDayTransfer: 104857600,
                power: 1,
                usedMonthlyTransfer: 0,
                timeZoneOffset: 420,
                usedDayTransfer: 1024 * 500,
                resetTime: new Date('2017-08-29T14:08:02.803Z'),
                availableMonthlyTransfer: 1073741824,
                startDate: new Date('2017-08-29T14:08:02.803Z'),
                transferMonthly: 1073741824,
                transferDayLimit: 104857600
            };
            setTimeout(() => {
                com.error = -1;
                com.Args = [transfer];
                CallBack(com);
            }, 2000);
            /*
            this.QTClass.request ( com, ( err: number, res: QTGateAPIRequestCommand ) => {
                const arg = res.Args[0]
                console.log(typeof arg )
                console.log(Object.keys(arg))
                console.log(arg)
            })
            */
        });
    }
    addInImapData(imapData) {
        const index = this.imapDataPool.findIndex(n => { return n.uuid === imapData.uuid; });
        if (index === -1) {
            const data = {
                email: imapData.email,
                imapServer: imapData.imapServer,
                imapPortNumber: imapData.imapPortNumber,
                imapSsl: imapData.imapSsl,
                imapUserName: imapData.imapUserName,
                imapUserPassword: imapData.imapUserPassword,
                imapIgnoreCertificate: imapData.imapIgnoreCertificate,
                smtpPortNumber: imapData.smtpPortNumber,
                smtpServer: imapData.smtpServer,
                smtpSsl: imapData.smtpSsl,
                smtpUserName: imapData.smtpUserName,
                smtpUserPassword: imapData.smtpUserPassword,
                smtpIgnoreCertificate: imapData.smtpIgnoreCertificate,
                imapTestResult: null,
                account: imapData.account,
                imapCheck: imapData.imapCheck,
                smtpCheck: imapData.smtpCheck,
                sendToQTGate: imapData.sendToQTGate,
                serverFolder: null,
                clientFolder: null,
                connectEmail: null,
                validated: null,
                language: imapData.language,
                timeZoneOffset: imapData.timeZoneOffset,
                randomPassword: null,
                uuid: imapData.uuid,
                canDoDelete: imapData.canDoDelete
            };
            this.imapDataPool.unshift(data);
            return 0;
        }
        const data = this.imapDataPool[index];
        // - 
        data.email = imapData.email;
        data.imapServer = imapData.imapServer;
        data.imapPortNumber = imapData.imapPortNumber;
        data.imapSsl = imapData.imapSsl;
        data.imapUserName = imapData.imapUserName;
        data.imapUserPassword = imapData.imapUserPassword;
        data.smtpPortNumber = imapData.smtpPortNumber;
        data.smtpServer = imapData.smtpServer;
        data.smtpSsl = imapData.smtpSsl;
        data.smtpUserName = imapData.smtpUserName;
        data.smtpUserPassword = imapData.smtpUserPassword;
        // -
        return index;
    }
    //- socket server 
    socketConnectListen(socket) {
        socket.on('init', (Callback) => {
            const ret = emitConfig(this.config, false);
            Callback(null, ret);
        });
        socket.on('agree', (callback) => {
            this.config.firstRun = false;
            this.config.alreadyInit = true;
            this.saveConfig();
            return callback();
        });
        socket.on('NewKeyPair', (preData) => {
            //		already have key pair
            if (this.config.keypair.createDate) {
                return socket.emit('newKeyPairCallBack', this.config.keypair);
            }
            this.savedPasswrod = preData.password;
            this.listenAfterPassword(socket);
            return this.getPbkdf2(this.savedPasswrod, (err, Pbkdf2Password) => {
                preData.password = Pbkdf2Password.toString('hex');
                RendererProcess('newKeyPair', preData, (retData) => {
                    if (!retData)
                        return this.socketServer.emit('newKeyPairCallBack');
                    saveLog(`RendererProcess finished [${retData}]`);
                    return getKeyPairInfo(retData.publicKey, retData.privateKey, preData.password, (err1, keyPairInfoData) => {
                        if (err1) {
                            saveLog('server.js getKeyPairInfo ERROR: ' + err1.message + '\r\n' + JSON.stringify(err));
                            return this.socketServer.emit('newKeyPairCallBack');
                        }
                        this.config.keypair = keyPairInfoData;
                        this.config.account = keyPairInfoData.email;
                        this.saveConfig();
                        const ret = KeyPairDeleteKeyDetail(this.config.keypair, true);
                        return this.socketServer.emit('newKeyPairCallBack', keyPairInfoData);
                    });
                });
            });
        });
        socket.on('deleteKeyPair', () => {
            const config = InitConfig(true, this.version);
            config.newVerReady = this.config.newVerReady;
            config.newVersion = this.config.newVersion;
            this.config = config;
            this.config.firstRun = false;
            this.config.alreadyInit = true;
            this.savedPasswrod = '';
            this.imapDataPool = [];
            this.saveImapData();
            this.saveConfig();
            if (this.QTClass) {
                this.QTClass.destroy(1);
                this.QTClass = null;
            }
            return socket.emit('deleteKeyPair');
        });
        socket.once('newVersionInstall', (CallBack) => {
            if (this.config.newVerReady)
                return process.send(`checkVersion: ${this.config.newVersion}`);
        });
        socket.on('checkPemPassword', (password, callBack) => {
            let keyPair = null;
            if (!password || password.length < 5 || !this.config.keypair || !this.config.keypair.createDate) {
                saveLog('server.js socket on checkPemPassword passwrod or keypair error!' +
                    `[${!password}][${password.length < 5}][${!this.config.keypair.publicKey}][${!this.config.keypair.publicKey.length}][${!this.config.keypair.privateKey}][${!this.config.keypair.privateKey.length}]`);
                return callBack(false);
            }
            if (this.savedPasswrod && this.savedPasswrod.length) {
                if (this.savedPasswrod !== password)
                    return callBack(false);
                callBack(true, this.imapDataPool);
                this.listenAfterPassword(socket);
                return this.emitQTGateToClient(socket, null);
            }
            return Async.waterfall([
                (next) => {
                    return this.getPbkdf2(password, next);
                },
                (data, next) => {
                    return getKeyPairInfo(this.config.keypair.publicKey, this.config.keypair.privateKey, data.toString('hex'), next);
                }
            ], (err, _keyPair) => {
                if (err) {
                    saveLog(`socket.on checkPemPassword ERROR: ${JSON.stringify(err)}`);
                    return callBack(err);
                }
                this.config.keypair = keyPair = _keyPair;
                if (!keyPair.passwordOK)
                    return callBack(keyPair.passwordOK);
                this.listenAfterPassword(socket);
                this.savedPasswrod = password;
                this.readImapData((err) => {
                    if (err) {
                        return saveLog('checkPemPassword readImapData got error! ' + err.message);
                    }
                    socket.emit('ImapData', this.imapDataPool);
                    //		check imap data
                    return this.emitQTGateToClient(socket, null);
                });
                return callBack(keyPair.passwordOK);
            });
        });
        socket.on('CancelCreateKeyPair', () => {
            if (this.CreateKeyPairProcess) {
                console.log(`CreateKeyPairProcess kill!`);
                this.CreateKeyPairProcess.kill();
                this.CreateKeyPairProcess = null;
            }
        });
        socket.on('checkUpdateBack', (jsonData) => {
            this.config.newVersionCheckFault = true;
            if (!jsonData) {
                return saveLog(`socket.on checkUpdateBack but have not jsonData`);
            }
            const { tag_name, assets } = jsonData;
            if (!tag_name) {
                return saveLog(`socket.on checkUpdateBack but have not jsonData`);
            }
            this.config.newVersionCheckFault = false;
            const ver = jsonData.tag_name;
            console.log(`config.version = [${this.config.version}] ver = [${ver}]`);
            if (ver <= this.config.version || !assets || assets.length < 7) {
                console.log(`no new version!`);
                return saveLog(`server.js checkVersion no new version! ver=[${ver}], newVersion[${this.config.newVersion}] jsonData.assets[${jsonData.assets ? jsonData.assets.length : null}]`);
            }
            saveLog('server.js checkVersion have new version:' + ver);
            this.config.newVersion = ver;
            //process.send ( jsonData )
            process.once('message', message => {
                console.log(`server on process.once message`, message);
                if (message) {
                    ++this.config.newVersionDownloadFault;
                    this.saveConfig();
                    return saveLog(`getDownloadFiles callBack ERROR!`);
                }
                this.config.newVersionDownloadFault = 0;
                this.config.newVersionCheckFault = false;
                this.config.newVerReady = true;
                this.saveConfig();
            });
        });
    }
    //--------------------------   check imap setup
    checkConfig() {
        Fs.access(configPath, err => {
            if (err) {
                createWindow();
                return this.config = InitConfig(true, this.version);
            }
            try {
                const config = require(configPath);
                config.salt = Buffer.from(config.salt.data);
                this.config = config;
                if (this.config.keypair && this.config.keypair.publicKeyID)
                    return Async.waterfall([
                        next => {
                            if (!this.config.keypair.publicKey)
                                return checkKey(this.config.keypair.publicKeyID, next);
                            return next(null, null);
                        },
                        (data, next) => {
                            if (data) {
                                this.config.keypair.publicKey = data;
                            }
                            getKeyPairInfo(this.config.keypair.publicKey, this.config.keypair.privateKey, null, next);
                        }
                    ], (err, keyPair) => {
                        if (err || !keyPair) {
                            createWindow();
                            return saveLog(`checkConfig keyPair Error! [${JSON.stringify(err)}]`);
                        }
                        return myIpServer((err, ipaddress) => {
                            this.config.keypair = keyPair;
                            this.config.serverGlobalIpAddress = ipaddress;
                            this.saveConfig();
                            return createWindow();
                        });
                    });
                return createWindow();
            }
            catch (e) {
                saveLog('localServer->checkConfig: catch ERROR: ' + e.message);
                createWindow();
                return this.config = InitConfig(true, this.version);
            }
        });
    }
    getPbkdf2(passwrod, CallBack) {
        Crypto1.pbkdf2(passwrod, this.config.salt, this.config.iterations, this.config.keylen, this.config.digest, CallBack);
    }
    smtpVerify(imapData, CallBack) {
        const option = {
            host: Net.isIP(imapData.smtpServer) ? null : imapData.smtpServer,
            hostname: Net.isIP(imapData.smtpServer) ? imapData.smtpServer : null,
            port: imapData.smtpPortNumber,
            requireTLS: imapData.smtpSsl,
            auth: {
                user: imapData.smtpUserName,
                pass: imapData.smtpUserPassword
            },
            connectionTimeout: (1000 * 15).toString(),
            tls: imapData.smtpIgnoreCertificate ? {
                rejectUnauthorized: false
            } : imapData.smtpSsl,
        };
        const transporter = Nodemailer.createTransport(option);
        transporter.verify((err, success) => {
            DEBUG ? saveLog(`transporter.verify callback err:[${JSON.stringify(err)}] success[${success}]`) : null;
            if (err) {
                const _err = JSON.stringify(err);
                if (/Invalid login|AUTH/i.test(_err))
                    return CallBack(8);
                if (/certificate/i.test(_err))
                    return CallBack(9);
                return CallBack(10);
            }
            return CallBack();
        });
    }
    sendMailToQTGate(imapData, text, Callback) {
        const option = {
            host: imapData.smtpServer,
            port: imapData.smtpPortNumber,
            requireTLS: imapData.smtpSsl,
            auth: {
                user: imapData.smtpUserName,
                pass: imapData.smtpUserPassword
            }
        };
        const transporter = Nodemailer.createTransport(option);
        const mailOptions = {
            from: imapData.email,
            to: 'QTGate@QTGate.com',
            subject: 'QTGate',
            attachments: [{
                    content: text
                }]
        };
        transporter.sendMail(mailOptions, (err, info, infoID) => {
            if (err) {
                console.log(`transporter.sendMail got ERROR!`, err);
                return Callback(err);
            }
            console.log(`transporter.sendMail success!`);
            return Callback();
        });
    }
    sendEmailTest(imapData, CallBack) {
        if (!this.savedPasswrod) {
            const err = 'sendEmailToQTGate ERROR! have not password!';
            saveLog(err);
            return CallBack(new Error(err));
        }
        Async.parallel([
            next => readQTGatePublicKey(next),
            next => this.getPbkdf2(this.savedPasswrod, next)
        ], (err, data) => {
            if (err) {
                saveLog(`sendEmailToQTGate readQTGatePublicKey && getPbkdf2 got ERROR [${Util.inspect(err)}]`);
                return CallBack(err);
            }
            const qtgateCommand = {
                account: this.config.account,
                QTGateVersion: this.config.version,
                imapData: imapData,
                command: 'connect',
                error: null,
                callback: null,
                language: imapData.language,
                publicKey: this.config.keypair.publicKey
            };
            let key = data[0].toString();
            let password = data[1].toString('hex');
            if (!/^-----BEGIN PGP PUBLIC KEY BLOCK-----/.test(key)) {
                key = data[1].toString();
                password = data[0].toString('hex');
            }
            Async.waterfall([
                (next) => encryptWithKey(JSON.stringify(qtgateCommand), key, this.config.keypair.privateKey, password, next),
                (_data, next) => { this.sendMailToQTGate(imapData, _data, next); }
            ], (err1) => {
                if (err1) {
                    saveLog(`encryptWithKey && sendMailToQTGate got ERROR [${Util.inspect(err1)}]`);
                    return CallBack(err1);
                }
                return CallBack();
            });
        });
    }
    imapTest(imapData, CallBack) {
        const testNumber = 4;
        const uu = next => {
            Imap.imapAccountTest(imapData, next);
        };
        const uu1 = Array(testNumber).fill(uu);
        console.log(`do imapTest!`);
        Async.parallel(uu1, (err, num) => {
            if (err) {
                const message = err.message;
                if (message && message.length) {
                    if (/Auth|Lookup failed|Invalid|Login|username/i.test(message))
                        return CallBack(3);
                    if (/ECONNREFUSED/i.test(message))
                        return CallBack(4);
                    if (/certificate/i.test(message))
                        return CallBack(5);
                    if (/timeout/i.test(message)) {
                        return CallBack(7);
                    }
                    if (/ENOTFOUND/i.test(message)) {
                        return CallBack(6);
                    }
                }
                return CallBack(4);
            }
            let time = 0;
            num.forEach(n => {
                time += n;
            });
            const ret = Math.round(time / testNumber);
            return CallBack(null, ret);
        });
    }
    emitQTGateToClient(socket, _imapUuid) {
        let sendWhenTimeOut = true;
        if (this.qtGateConnectEmitData && this.qtGateConnectEmitData.qtGateConnecting) {
            this.qtGateConnectEmitData.qtGateConnecting = 1;
            socket.emit('qtGateConnect', this.qtGateConnectEmitData);
            return this.QTClass.checkConnect(err => {
                this.qtGateConnectEmitData.qtGateConnecting = 2;
                return socket.emit('qtGateConnect', this.qtGateConnectEmitData);
            });
        }
        if (!_imapUuid) {
            if (this.imapDataPool.length < 1) {
                return socket.emit('qtGateConnect', null);
            }
            if (!this.config.QTGateConnectImapUuid) {
                this.config.QTGateConnectImapUuid = this.imapDataPool[0].uuid;
            }
        }
        else {
            this.config.QTGateConnectImapUuid = _imapUuid;
        }
        //	sendToQTGate
        //	case 0: conform
        //	case 1: connecting
        //	case 2: connected
        //	case 3: connect error & error = error number
        //	case 4: sent conform & wait return from QTGate
        const index = this.imapDataPool.findIndex(n => { return n.uuid === this.config.QTGateConnectImapUuid; });
        if (index < 0) {
            console.log(`if ( index < 0 )`);
            this.config.QTGateConnectImapUuid = this.imapDataPool[0].uuid;
            this.QTGateConnectImap = 0;
        }
        else {
            this.QTGateConnectImap = index;
        }
        const imapData = this.imapDataPool[this.QTGateConnectImap];
        if (!imapData.imapCheck || !imapData.smtpCheck || !imapData.imapTestResult)
            return;
        if (!this.imapDataPool.length) {
            return;
        }
        const ret = {
            qtgateConnectImapAccount: this.config.QTGateConnectImapUuid,
            qtGateConnecting: !imapData.sendToQTGate ? 0 : 1,
            isKeypairQtgateConform: this.config.keypair.verified,
            error: null
        };
        const doConnect = () => {
            if (!this.imapDataPool.length)
                return;
            this.QTClass = new ImapConnect(imapData, this.qtGateConnectEmitData, sendWhenTimeOut, this, this.savedPasswrod, (err) => {
                console.log(`ImapConnect exit with err: [${err}]`);
                if (err !== null) {
                    //		have connect error
                    if (err > 0) {
                        this.qtGateConnectEmitData.qtGateConnecting = 3;
                        this.qtGateConnectEmitData.error = err;
                        return socket.emit('qtGateConnect', this.qtGateConnectEmitData);
                    }
                    // QTGate disconnected resend connect request
                    console.log(`QTGate disconnected resend connect request`);
                    imapData.sendToQTGate = false;
                    this.saveImapData();
                }
                console.log(`restart this.QTClass!`);
                this.QTClass.removeAllListeners();
                this.QTClass = null;
                return doConnect();
            }, socket);
        };
        this.qtGateConnectEmitData = ret;
        socket.emit('qtGateConnect', ret);
        if (ret.qtGateConnecting === 0) {
            return;
        }
        if (!imapData.serverFolder || !imapData.uuid || imapData.canDoDelete) {
            console.log('have not imapData serverFolder', imapData);
            imapData.serverFolder = Uuid.v4();
            imapData.clientFolder = Uuid.v4();
            imapData.randomPassword = Uuid.v4();
            imapData.sendToQTGate = false;
            imapData.canDoDelete = false;
        }
        this.saveImapData();
        if (!imapData.sendToQTGate) {
            sendWhenTimeOut = false;
            return this.sendEmailTest(imapData, err => {
                if (err) {
                    console.log(`sendEmailTest got error!`, err);
                    this.qtGateConnectEmitData.qtGateConnecting = 3;
                    this.qtGateConnectEmitData.error = 0;
                    return socket.emit('qtGateConnect', this.qtGateConnectEmitData);
                }
                imapData.sendToQTGate = true;
                this.saveImapData();
                return doConnect();
            });
        }
        doConnect();
    }
    doingCheck(id, _imapData, socket) {
        const imapData = this.imapDataPool[this.addInImapData(_imapData)];
        imapData.imapCheck = imapData.smtpCheck = false;
        imapData.imapTestResult = 0;
        this.saveImapData();
        this.imapTest(imapData, (err, code) => {
            socket.emit(id + '-imap', err ? err : null, code);
            imapData.imapTestResult = code;
            imapData.imapCheck = code > 0;
            this.saveImapData();
            if (err)
                return;
            this.smtpVerify(imapData, (err1) => {
                socket.emit(id + '-smtp', err1 ? err1 : null);
                imapData.smtpCheck = !err1;
                this.saveImapData();
                if (err1)
                    return;
                this.emitQTGateToClient(socket, _imapData.uuid);
            });
        });
    }
    shutdown() {
        this.saveConfig();
        this.saveImapData();
        this.httpServer.close();
    }
}
exports.localServer = localServer;
class ImapConnect extends Imap.imapPeer {
    constructor(imapData, qtGateConnectEmitData, exitWhenServerNotReady, localServer, password, exit, socket) {
        super(imapData, imapData.clientFolder, imapData.serverFolder, (text, CallBack) => {
            this._enCrypto(text, CallBack);
        }, (text, CallBack) => {
            this._deCrypto(text, CallBack);
        }, err => {
            if (exit) {
                exit(this.errNumber(err));
                exit = null;
            }
        });
        this.imapData = imapData;
        this.qtGateConnectEmitData = qtGateConnectEmitData;
        this.localServer = localServer;
        this.QTGatePublicKey = null;
        this.password = null;
        this.sendReqtestMail = false;
        this.QTGateServerready = false;
        this.localGlobalIpAddress = null;
        this.commandCallBackPool = new Map();
        Async.parallel([
            next => readQTGatePublicKey(next),
            next => this.localServer.getPbkdf2(password, next)
        ], (err, data) => {
            if (err) {
                return console.log(err);
            }
            this.QTGatePublicKey = data[0].toString();
            this.password = data[1].toString('hex');
            if (!/^-----BEGIN PGP PUBLIC KEY BLOCK-----/.test(this.QTGatePublicKey)) {
                this.QTGatePublicKey = data[1].toString();
                this.password = data[0].toString('hex');
            }
        });
        const readyTime = exitWhenServerNotReady ? setTimeout(() => {
            console.log(`server not ready!, send request mail!`);
            this.localServer.sendEmailTest(imapData, err => {
                if (err)
                    return console.log(`localServer.sendEmailTest got error!`, err);
            });
        }, QTGatePongReplyTime) : null;
        this.once('ready', () => {
            clearTimeout(readyTime);
            this.QTGateServerready = true;
            imapData.canDoDelete = false;
            qtGateConnectEmitData.qtGateConnecting = 2;
            this.localServer.saveImapData();
            return socket.emit('qtGateConnect', qtGateConnectEmitData);
        });
        this.newMail = (ret) => {
            if (!ret || !ret.requestSerial) {
                console.log('QTGateAPIRequestCommand have not requestSerial! ');
                return saveLog('QTGateAPIRequestCommand have not requestSerial! ');
            }
            const CallBack = this.commandCallBackPool.get(ret.requestSerial);
            if (!CallBack || typeof CallBack !== 'function') {
                console.log(`ret.requestSerial [${ret.requestSerial}] have not callback `);
                return saveLog(`ret.requestSerial [${ret.requestSerial}] have not callback `);
            }
            console.log(`got QTGate CallBack success for return [${ret.requestSerial}]`);
            return CallBack(null, ret);
        };
    }
    errNumber(err) {
        if (!err || !err.message)
            return null;
        const message = err.message;
        if (/Auth|Lookup failed|Invalid|Login|username/i.test(message))
            return 3;
        if (/ECONNREFUSED/i.test(message))
            return 4;
        if (/certificate/i.test(message))
            return 5;
        if (/timeout/i.test(message)) {
            return 7;
        }
        if (/peer not ready/i.test(message))
            return 0;
        return 6;
    }
    _enCrypto(text, CallBack) {
        return encryptWithKey(text, this.QTGatePublicKey, this.localServer.config.keypair.privateKey, this.password, CallBack);
    }
    _deCrypto(text, CallBack) {
        return deCryptoWithKey(text, this.QTGatePublicKey, this.localServer.config.keypair.privateKey, this.password, CallBack);
    }
    request(command, CallBack) {
        this.commandCallBackPool.set(command.requestSerial, CallBack);
        this._enCrypto(JSON.stringify(command), (err1, data) => {
            if (err1) {
                console.log(`_deCrypto got error `, err1);
                return CallBack(err1);
            }
            this.append(data);
            console.log(`request finished and wait server responsr!`);
        });
    }
    checkConnect(CallBack) {
        console.log(`doing checkConnect `);
        const time = setTimeout(() => {
            console.log(`server not ready!, send request mail!`);
            this.localServer.sendEmailTest(this.imapData, err => {
                if (err)
                    return console.log(`localServer.sendEmailTest got error!`, err);
            });
        }, QTGatePongReplyTime);
        this.once('ready', () => {
            console.log(`server ready clear setTimeout`);
            clearTimeout(time);
            CallBack();
        });
        this.Ping();
    }
}
const port = remote.getCurrentWindow().rendererSidePort;
const server = new localServer(version, port);
saveLog(`***************** start server at port [${port}] version = [${version}] ***************** `);
const _doUpdate = (tag_name) => {
    let url = null;
    if (process.platform === 'darwin') {
        url = `http://127.0.0.1:3000/update/mac?ver=${tag_name}`;
    }
    else if (process.platform === 'win32') {
        url = `http://127.0.0.1:3000/latest/${tag_name}/`;
    }
    else {
        return;
    }
    const autoUpdater = remote.require('electron').autoUpdater;
    autoUpdater.on('update-availabe', () => {
        console.log('update available');
    });
    autoUpdater.on('error', err => {
        console.log('systemError autoUpdater.on error ' + err.message);
    });
    autoUpdater.on('checking-for-update', () => {
        console.log(`checking-for-update [${url}]`);
    });
    autoUpdater.on('update-not-available', () => {
        console.log('update-not-available');
    });
    autoUpdater.on('update-downloaded', e => {
        console.log("Install?");
        autoUpdater.quitAndInstall();
    });
    autoUpdater.setFeedURL(url);
    autoUpdater.checkForUpdates();
};