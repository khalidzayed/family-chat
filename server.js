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

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(compression());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use(session({
  secret: process.env.SESSION_SECRET || 'family-chat-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI || 'mongodb+srv://khalidzayed9:Mihyar%401994@cluster0.oontoc8.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0',
    collectionName: 'sessions',
    ttl: 24 * 60 * 60
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'secret-key-32-chars-long12345678';

mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://khalidzayed9:Mihyar%401994@cluster0.oontoc8.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
  serverSelectionTimeoutMS: 5000
})
  .then(() => {
    console.log('متصل بـ MongoDB بنجاح');
    initializeUsers();
  })
  .catch(err => console.error('فشل الاتصال بـ MongoDB:', err));

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true }
});

UserSchema.pre('save', async function(next) {
  try {
    if (this.isModified('password') || this.isNew) {
      console.log(`جاري تشفير كلمة المرور لـ ${this.username}`);
      const salt = await bcrypt.genSalt(10);
      this.password = await bcrypt.hash(this.password, salt);
      console.log(`تم تشفير كلمة المرور لـ ${this.username} بنجاح`);
    }
    next();
  } catch (err) {
    console.error('فشل تشفير كلمة المرور:', err.message);
    next(err);
  }
});

const User = mongoose.model('User', UserSchema);

const MessageSchema = new mongoose.Schema({
  username: { type: String, required: true },
  message: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', MessageSchema);

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

app.get('/api/username', isAuthenticated, (req, res) => {
  res.json({ username: req.session.user });
});

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

app.get('/api/users', isAuthenticated, async (req, res) => {
  try {
    const users = await User.find({}, 'username');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'فشل جلب المستخدمين' });
  }
});

app.post('/api/users', isAuthenticated, async (req, res) => {
  const { username, password } = req.body;
  console.log('محاولة إضافة مستخدم:', { username, password });
  if (!username || !password) {
    console.error('البيانات ناقصة:', { username, password });
    return res.status(400).send('اسم المستخدم وكلمة المرور مطلوبان');
  }
  try {
    const user = new User({ username, password });
    await user.save();
    console.log('تم إضافة المستخدم بنجاح:', username);
    res.status(201).send('تم إضافة المستخدم');
  } catch (err) {
    console.error('فشل إضافة المستخدم:', err.message);
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

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (user && await bcrypt.compare(password, user.password)) {
      req.session.user = username;
      res.redirect('/chat');
    } else {
      res.send('اسم المستخدم أو كلمة المرور غير صحيحة. <a href="/">عودة</a>');
    }
  } catch (err) {
    res.status(500).send('حدث خطأ أثناء تسجيل الدخول. <a href="/">عودة</a>');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
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

  console.log(`${socket.username} متصل`);
  socket.emit('message', `مرحبًا ${socket.username}!`);

  socket.on('message', async (msg) => {
    const encryptedMsg = CryptoJS.AES.encrypt(msg, ENCRYPTION_KEY).toString();
    const message = new Message({ username: socket.username, message: encryptedMsg });
    await message.save();
    const currentTime = new Date().toLocaleTimeString('ar-EG');
    io.emit('message', `${socket.username} [${currentTime}]: ${msg}`);
  });

  socket.on('disconnect', () => {
    connectedUsers.delete(socket.username);
    io.emit('users', Array.from(connectedUsers));
    console.log(`${socket.username} انقطع اتصاله`);
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
    console.log('بدء إضافة المستخدمين الأوليين...');
    for (const user of initialUsers) {
      const existingUser = await User.findOne({ username: user.username });
      if (!existingUser) {
        const newUser = new User(user);
        await newUser.save();
        console.log(`تم إضافة المستخدم: ${user.username} بكلمة مرور مشفرة`);
      } else {
        console.log(`المستخدم ${user.username} موجود بالفعل`);
      }
    }
    console.log('اكتملت عملية إضافة المستخدمين الأوليين');
  } catch (err) {
    console.error('فشل إضافة المستخدمين الأوليين:', err.message);
  }
}
