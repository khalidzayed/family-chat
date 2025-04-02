const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const bodyParser = require('body-parser');
const session = require('express-session');
const mongoose = require('mongoose');
const CryptoJS = require('crypto-js');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// الاتصال بـ MongoDB Atlas (استخدم متغير بيئة)
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost/family-chat')
  .then(() => console.log('متصل بـ MongoDB بنجاح'))
  .catch(err => console.error('فشل الاتصال بـ MongoDB:', err));

// نموذج المستخدم
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: String
});
const User = mongoose.model('User', UserSchema);

// نموذج الرسائل
const MessageSchema = new mongoose.Schema({
  username: String,
  message: String,
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

// إعداد Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use(session({
  secret: process.env.SESSION_SECRET || 'family-chat-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // غيّر إلى true عند HTTPS
}));

// مفتاح التشفير
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'secret-key-32-chars-long12345678';

// Middleware للتحقق من تسجيل الدخول
function isAuthenticated(req, res, next) {
  if (req.session.user) return next();
  res.redirect('/');
}

// صفحة تسجيل الدخول
app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/chat');
  res.sendFile(path.join(__dirname, 'login.html'));
});

// صفحة المحادثة
app.get('/chat', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// صفحة إدارة المستخدمين
app.get('/manage-users', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'manage-users.html'));
});

// API لجلب اسم المستخدم
app.get('/api/username', isAuthenticated, (req, res) => {
  res.json({ username: req.session.user });
});

// API لجلب الرسائل السابقة
app.get('/api/messages', isAuthenticated, async (req, res) => {
  try {
    const messages = await Message.find().sort({ timestamp: 1 }).limit(50);
    const decryptedMessages = messages.map(msg => ({
      ...msg._doc,
      message: CryptoJS.AES.decrypt(msg.message, ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8)
    }));
    res.json(decryptedMessages);
  } catch (err) {
    res.status(500).json({ error: 'فشل جلب الرسائل' });
  }
});

// API لجلب المستخدمين
app.get('/api/users', isAuthenticated, async (req, res) => {
  const users = await User.find({}, 'username');
  res.json(users);
});

// API لإضافة مستخدم
app.post('/api/users', isAuthenticated, async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = new User({ username, password });
    await user.save();
    res.status(201).send('تم إضافة المستخدم');
  } catch (err) {
    res.status(400).send('اسم المستخدم موجود بالفعل');
  }
});

// API لحذف مستخدم
app.delete('/api/users/:username', isAuthenticated, async (req, res) => {
  await User.deleteOne({ username: req.params.username });
  res.status(200).send('تم حذف المستخدم');
});

// معالجة تسجيل الدخول
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username, password });
    if (user) {
      req.session.user = username;
      res.redirect('/chat');
    } else {
      res.send('اسم المستخدم أو كلمة المرور غير صحيحة. <a href="/">عودة</a>');
    }
  } catch (err) {
    res.status(500).send('حدث خطأ أثناء تسجيل الدخول. <a href="/">عودة</a>');
  }
});

// تسجيل الخروج
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// إدارة WebSocket
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

  console.log(`${socket.username} متصل`);
  socket.emit('message', `مرحبًا ${socket.username}!`);

  socket.on('message', async (msg) => {
    const encryptedMsg = CryptoJS.AES.encrypt(msg, ENCRYPTION_KEY).toString();
    const message = new Message({ username: socket.username, message: encryptedMsg });
    await message.save();
    io.emit('message', `${socket.username}: ${msg}`);
  });

  socket.on('disconnect', () => {
    connectedUsers.delete(socket.username);
    io.emit('users', Array.from(connectedUsers));
    console.log(`${socket.username} انقطع اتصاله`);
  });
});

// تشغيل الخادم
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`الخادم يعمل على المنفذ ${PORT}`);
});

// إضافة مستخدمين أوليين
async function initializeUsers() {
  const initialUsers = [
    { username: 'احمد', password: '1234' },
    { username: 'فاطمة', password: '5678' },
    { username: 'محمد', password: '9012' }
  ];
  for (const user of initialUsers) {
    if (!(await User.findOne({ username: user.username }))) {
      await new User(user).save();
    }
  }
}
initializeUsers();