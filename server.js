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

// إعداد الجلسة مع تحسينات
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
    secure: false, // Temporarily disable secure to debug
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'secret-key-32-chars-long12345678';

// التحقق من اتصال MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://khalidzayed9:Mihyar%401994@cluster0.oontoc8.mongodb.net/family_chat?retryWrites=true&w=majority&appName=Cluster0', {
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
  console.log('التحقق من الجلسة في isAuthenticated:', req.session);
  if (req.session.user) {
    console.log('تم العثور على المستخدم في الجلسة:', req.session.user);
    return next();
  }
  console.log('الجلسة غير موجودة، إعادة توجيه إلى /');
  res.redirect('/');
}

app.get('/', (req, res) => {
  if (req.session.user) {
    console.log('المستخدم موجود في الجلسة، إعادة توجيه إلى /chat:', req.session.user);
    return res.redirect('/chat');
  }
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/chat', isAuthenticated, (req, res) => {
  console.log('الوصول إلى /chat لـ:', req.session.user);
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/manage-users', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'manage-users.html'));
});

app.get('/api/username', (req, res) => {
  console.log('طلب /api/username، الجلسة:', req.session);
  if (req.session.user) {
    res.json({ username: req.session.user });
  } else {
    res.status(401).json({ error: 'غير مصادق' });
  }
});

app.get('/api/messages', isAuthenticated, async (req, res) => {
  try {
    const messages = await Message.find().sort({ timestamp: 1 }).limit(50);
    console.log('الرسائل المستردة:', messages);
    const decryptedMessages = messages.map(msg => ({
      ...msg._doc,
      message: CryptoJS.AES.decrypt(msg.message, ENCRYPTION_KEY).toString(CryptoJS.enc.Utf8)
    }));
    res.json(decryptedMessages);
  } catch (err) {
    console.error('خطأ في جلب الرسائل:', err);
    res.status(500).json({ error: 'فشل جلب الرسائل' });
  }
});

app.get('/api/users', isAuthenticated, async (req, res) => {
  try {
    const users = await User.find({}, 'username');
    console.log('المستخدمون المستردون:', users);
    res.json(users);
  } catch (err) {
    console.error('خطأ في جلب المستخدمين:', err);
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
  console.log('البيانات المستلمة:', { username, password });
  if (!username || !password) {
    console.log('البيانات ناقصة:', { username, password });
    return res.status(400).send('اسم المستخدم وكلمة المرور مطلوبان. <a href="/">عودة</a>');
  }
  try {
    const user = await User.findOne({ username });
    if (user && await bcrypt.compare(password, user.password)) {
      req.session.user = username;
      console.log('تم تعيين الجلسة لـ:', username);
      req.session.save((err) => {
        if (err) {
          console.error('خطأ أثناء حفظ الجلسة:', err);
          return res.status(500).send('خطأ أثناء تسجيل الدخول. <a href="/">عودة</a>');
        }
        console.log('تم حفظ الجلسة بنجاح لـ:', username);
        res.redirect('/chat');
      });
    } else {
      console.log('فشل تسجيل الدخول لـ:', username);
      res.status(401).send('اسم المستخدم أو كلمة المرور غير صحيحة. <a href="/">عودة</a>');
    }
  } catch (err) {
    console.error('خطأ أثناء تسجيل الدخول:', err);
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
  console.log('مستخدم متصل:', socket.username);
  io.emit('users', Array.from(connectedUsers));

  socket.emit('message', `مرحبًا ${socket.username}!`);

  socket.on('message', async (msg) => {
    console.log('رسالة مستلمة من:', socket.username, 'النص:', msg);
    if (!msg || msg.trim() === '') {
      console.log('الرسالة فارغة، تم تجاهلها');
      return;
    }
    const encryptedMsg = CryptoJS.AES.encrypt(msg, ENCRYPTION_KEY).toString();
    const message = new Message({ username: socket.username, message: encryptedMsg });
    try {
      await message.save();
      const currentTime = new Date().toLocaleTimeString('ar-EG');
      const fullMessage = `${socket.username} [${currentTime}]: ${msg}`;
      console.log('رسالة مرسلة:', fullMessage);
      io.emit('message', fullMessage);
    } catch (err) {
      console.error('خطأ أثناء حفظ الرسالة:', err);
    }
  });

  socket.on('disconnect', () => {
    connectedUsers.delete(socket.username);
    console.log('مستخدم انقطع اتصاله:', socket.username);
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
