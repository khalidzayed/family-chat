const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const mongoose = require('mongoose');
const CryptoJS = require('crypto-js');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const compression = require('compression');
const cloudinary = require('cloudinary').v2;
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(compression());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname));

// إعداد multer لرفع الملفات مؤقتًا
const upload = multer({
    dest: 'uploads/',
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('يُسمح برفع الصور فقط!'), false);
        }
        cb(null, true);
    },
    limits: { fileSize: 5 * 1024 * 1024 } // الحد الأقصى 5 ميجابايت
});

// إعداد Cloudinary
cloudinary.config({
    cloud_name: 'diara9dzg', // استبدل بـ Cloud Name الخاص بك
    api_key: '969277843346462',       // استبدل بـ API Key الخاص بك
    api_secret: 'uuee0QzBTNDVB-809XDoJCDRJhE'  // استبدل بـ API Secret الخاص بك
});

app.use(session({
    secret: process.env.SESSION_SECRET || 'family-chat-secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI || 'mongodb+srv://khalidzayed9:Mihyar%401994@cluster0.oontoc8.mongodb.net/family_chat?retryWrites=true&w=majority&appName=Cluster0',
        collectionName: 'sessions',
        ttl: 24 * 60 * 60,
        autoRemove: 'native'
    }),
    cookie: {
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
    }
}));

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'secret-key-32-chars-long12345678';

mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://khalidzayed9:Mihyar%401994@cluster0.oontoc8.mongodb.net/family_chat?retryWrites=true&w=majority&appName=Cluster0', {
    serverSelectionTimeoutMS: 5000
}).then(() => {
    console.log('متصل بـ MongoDB بنجاح');
    initializeUsers();
}).catch(err => console.error('فشل الاتصال بـ MongoDB:', err));

// نموذج المستخدم مع حقل الصورة الشخصية
const UserSchema = new mongoose.Schema({
    username: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    profilePicture: { type: String, default: 'https://res.cloudinary.com/demo/image/upload/v1312461204/sample.jpg' }
});

UserSchema.pre('save', async function(next) {
    try {
        if (this.isModified('password') || this.isNew) {
            const salt = await bcrypt.genSalt(10);
            this.password = await bcrypt.hash(this.password, salt);
        }
        next();
    } catch (err) {
        next(err);
    }
});

const User = mongoose.model('User', UserSchema);

const MessageSchema = new mongoose.Schema({
    sender: { type: String, required: true },
    recipient: { type: String, required: true },
    message: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    isGroup: { type: Boolean, default: false }
});

const Message = mongoose.model('Message', MessageSchema);

const GroupSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true },
    members: [{ type: String }],
    creator: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const Group = mongoose.model('Group', GroupSchema);

function isAuthenticated(req, res, next) {
    if (req.session.user) return next();
    res.redirect('/');
}

app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/chat');
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/chat', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/manage-users', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'manage-users.html'));
});

app.get('/profile', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'profile.html'));
});

app.get('/api/username', (req, res) => {
    if (req.session.user) {
        res.json({ username: req.session.user });
    } else {
        res.status(401).json({ error: 'غير مصادق' });
    }
});

app.get('/api/messages', isAuthenticated, async (req, res) => {
    const { recipient, isGroup } = req.query;
    try {
        const query = isGroup === 'true' ?
            { recipient, isGroup: true } :
            {
                $or: [
                    { sender: req.session.user, recipient },
                    { sender: recipient, recipient: req.session.user }
                ],
                isGroup: false
            };
        const messages = await Message.find(query).sort({ timestamp: 1 }).limit(50);
        const decryptedMessages = messages.map(msg => ({
            ...msg._doc,
            message: CryptoJS.AES.decrypt(msg.message, ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8)
        }));
        res.json(decryptedMessages);
    } catch (err) {
        res.status(500).json({ error: 'فشل جلب الرسائل' });
    }
});

app.get('/api/users', isAuthenticated, async (req, res) => {
    try {
        const users = await User.find({}, 'username profilePicture');
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: 'فشل جلب المستخدمين' });
    }
});

app.post('/api/users', isAuthenticated, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).send('اسم المستخدم وكلمة المرور مطلوبان');
    }
    try {
        const user = new User({ username, password });
        await user.save();
        res.status(201).send('تم إضافة المستخدم');
    } catch (err) {
        res.status(400).send('اسم المستخدم موجود بالفعل أو خطأ آخر: ' + err.message);
    }
});

app.delete('/api/users/:username', isAuthenticated, async (req, res) => {
    try {
        await User.deleteOne({ username: req.params.username });
        res.status(200).send('تم حذف المستخدم');
    } catch (err) {
        res.status(500).send('فشل حذف المستخدم');
    }
});

app.delete('/api/messages', isAuthenticated, async (req, res) => {
    const { message } = req.body;
    try {
        const [username, msgWithTime] = message.split(' [');
        const msg = msgWithTime.split(']: ')[1];
        const encryptedMsg = CryptoJS.AES.encrypt(msg, ENCRYPTION_KEY).toString();
        await Message.deleteOne({ username, message: encryptedMsg });
        res.status(200).send('تم حذف الرسالة');
    } catch (err) {
        res.status(500).send('فشل حذف الرسالة');
    }
});

// API لرفع الصورة الشخصية باستخدام multer و Cloudinary
app.post('/api/upload-profile-picture', isAuthenticated, upload.single('profilePicture'), async (req, res) => {
    try {
        // التحقق من وجود ملف مرفوع
        if (!req.file) {
            console.log('لم يتم رفع أي ملف');
            return res.status(400).send('لم يتم رفع أي صورة');
        }

        console.log('جاري رفع الصورة إلى Cloudinary:', req.file.path);
        // رفع الصورة إلى Cloudinary
        const result = await cloudinary.uploader.upload(req.file.path, {
            folder: 'profile_pictures',
            transformation: [
                { width: 100, height: 100, crop: 'fill' }
            ]
        });
        console.log('تم رفع الصورة بنجاح إلى Cloudinary:', result.secure_url);

        // تحديث الصورة الشخصية في قاعدة البيانات
        const user = await User.findOne({ username: req.session.user });
        if (!user) {
            console.log('المستخدم غير موجود:', req.session.user);
            return res.status(404).send('المستخدم غير موجود');
        }
        user.profilePicture = result.secure_url;
        await user.save();
        console.log('تم تحديث الصورة الشخصية في قاعدة البيانات:', user.profilePicture);

        res.status(200).send('تم تحديث الصورة الشخصية');
    } catch (err) {
        console.error('خطأ أثناء رفع الصورة:', err);
        res.status(500).send('فشل تحديث الصورة الشخصية: ' + err.message);
    }
});

app.post('/api/groups', isAuthenticated, async (req, res) => {
    const { name, members } = req.body;
    if (!name || !members || !Array.isArray(members)) {
        return res.status(400).send('اسم المجموعة والأعضاء مطلوبان');
    }
    try {
        const group = new Group({
            name,
            members: [...new Set([...members, req.session.user])],
            creator: req.session.user
        });
        await group.save();
        io.emit('groupCreated', group);
        res.status(201).send('تم إنشاء المجموعة');
    } catch (err) {
        res.status(400).send('اسم المجموعة موجود بالفعل أو خطأ آخر: ' + err.message);
    }
});

app.get('/api/groups', isAuthenticated, async (req, res) => {
    try {
        const groups = await Group.find({ members: req.session.user });
        res.json(groups);
    } catch (err) {
        res.status(500).json({ error: 'فشل جلب المجموعات' });
    }
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).send('اسم المستخدم وكلمة المرور مطلوبان. <a href="/">عودة</a>');
    }
    try {
        const user = await User.findOne({ username });
        if (user && await bcrypt.compare(password, user.password)) {
            req.session.user = username;
            req.session.save((err) => {
                if (err) {
                    return res.status(500).send('خطأ أثناء تسجيل الدخول. <a href="/">عودة</a>');
                }
                res.redirect('/chat');
            });
        } else {
            res.status(401).send('اسم المستخدم أو كلمة المرور غير صحيحة. <a href="/">عودة</a>');
        }
    } catch (err) {
        res.status(500).send('حدث خطأ أثناء تسجيل الدخول. <a href="/">عودة</a>');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('خطأ أثناء إنهاء الجلسة:', err);
        res.redirect('/');
    });
});

const connectedUsers = new Set();
io.use((socket, next) => {
    const username = socket.handshake.query.username;
    if (username) {
        socket.username = username;
        return next();
    }
    next(new Error('غير مصادق'));
});

io.on('connection', async (socket) => {
    connectedUsers.add(socket.username);
    io.emit('users', Array.from(connectedUsers));

    socket.emit('message', `مرحبًا ${socket.username}!`);

    socket.on('joinRoom', (room) => {
        socket.join(room);
        console.log(`${socket.username} انضم إلى الغرفة: ${room}`);
    });

    socket.on('privateMessage', async ({ recipient, message, isGroup }) => {
        if (!message || message.trim() === '') return;

        const room = isGroup ? recipient : [socket.username, recipient].sort().join('-');
        const encryptedMsg = CryptoJS.AES.encrypt(message, ENCRYPTION_KEY).toString();
        const msgData = new Message({
            sender: socket.username,
            recipient: isGroup ? recipient : recipient,
            message: encryptedMsg,
            isGroup,
            timestamp: new Date()
        });

        try {
            await msgData.save();
            const currentTime = new Date().toLocaleTimeString('ar-EG');
            const fullMessage = {
                sender: socket.username,
                message,
                timestamp: new Date().toISOString(),
                isGroup
            };
            io.to(room).emit('message', fullMessage);

            if (!isGroup) {
                const recipientSocket = Array.from(io.sockets.sockets.values()).find(s => s.username === recipient);
                if (recipientSocket && !recipientSocket.rooms.has(room)) {
                    recipientSocket.join(room);
                }
            }
        } catch (err) {
            console.error('خطأ أثناء حفظ الرسالة:', err);
        }
    });

    socket.on('disconnect', () => {
        connectedUsers.delete(socket.username);
        io.emit('users', Array.from(connectedUsers));
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`الخادم يعمل على المنفذ ${PORT}`);
});

async function initializeUsers() {
    const initialUsers = [
        { username: 'احمد', password: '1234' },
        { username: 'فاطمة', password: '5678' },
        { username: 'محمد', password: '9012' }
    ];

    try {
        for (const user of initialUsers) {
            const existingUser = await User.findOne({ username: user.username });
            if (!existingUser) {
                const newUser = new User(user);
                await newUser.save();
            }
        }
    } catch (err) {
        console.error('فشل إضافة المستخدمين الأوليين:', err.message);
    }
}
