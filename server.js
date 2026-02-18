const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');

dotenv.config();
const paystack = require('paystack');
const paystackClient = paystack(process.env.PAYSTACK_SECRET_KEY);

const app = express();

app.use(cors({
  origin: [
    'https://callygym-frontend-git-main-testimonys-projects-d315ec9a.vercel.app', // your exact live frontend URL
    'https://callygym-frontend.vercel.app', // if you have a custom domain/alias
    'http://localhost:5173', // for local dev testing
    '*' // temporary: allow all origins (remove this line later for security)
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true,
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

const port = process.env.PORT || 3000;

// app.use(cors());
app.use(express.json());

const prisma = new PrismaClient({ log: ['error'] });

prisma.$connect()
  .then(() => console.log('Prisma connected to database successfully'))
  .catch(err => console.error('Prisma connection FAILED:', err.message, err.stack));

// Book a session 
app.post('/api/bookings', async (req, res) => {
  const { name, email, phone, preferredDate } = req.body;

  if (!name || !email || !phone) {
    return res.status(400).json({
      success: false,
      message: 'Name, email, and phone are required'
    });
  }

  try {
    const newBooking = await prisma.booking.create({
      data: {
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        date: preferredDate ? new Date(preferredDate) : new Date(),
      },
    });
// const transporter = nodemailer.createTransport({
//       service: 'gmail',
//       auth: {
//         user: process.env.EMAIL_USER,
//         pass: process.env.EMAIL_PASS,
//       },
//     });

//     await transporter.sendMail({
//       from: `"CallyGym Booking" <${process.env.EMAIL_USER}>`,
//       to: process.env.EMAIL_USER,
//       replyTo: email,  
//       subject: `New Booking Request`,
//       text: `New booking received:\n\n` +
//             `Name: ${name}\n` +
//             `Email: ${email}\n` +
//             `Phone: ${phone}\n` +
//             `Preferred Date: ${preferredDate || 'ASAP'}\n` +
//             `Submitted: ${new Date().toLocaleString('en-NG')}\n\n` +
//             `Booking ID: ${newBooking.id}\n`,
//       html: `
//         <h2 style="color: #FF6B00;">New Booking Request</h2>
//         <p><strong>Name:</strong> ${name}</p>
//         <p><strong>Email:</strong> ${email}</p>
//         <p><strong>Phone:</strong> ${phone}</p>
//         <p><strong>Preferred Date:</strong> ${preferredDate || 'ASAP'}</p>
//         <p><strong>Submitted:</strong> ${new Date().toLocaleString('en-NG')}</p>
//         <p><strong>Booking ID:</strong> ${newBooking.id}</p>
//         <hr>
//         <p style="color: #666;">Reply to this email to contact the customer directly.</p>
//       `,
//     });
    res.status(201).json({
      success: true,
      message: 'Booking request received! We will contact you to confirm.',
      bookingId: newBooking.id,
    });
  } catch (err) {
    console.error('Booking error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to create booking. Please try again.'
    });
  }
});

// Contact Form
app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;

  if (!name || !email || !message) {
    return res.status(400).json({ success: false, message: 'All fields are required' });
  }

  try {
    await prisma.contact.create({
      data: {
        name: name.trim(),
        email: email.trim(),
        message: message.trim(),
      },
    });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      connectionTimeout: 60000, // 60s
      greetingTimeout: 60000,
      socketTimeout: 60000,
    });

    await transporter.sendMail({
      from: `"CallyGym Contact" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      replyTo: email,
      subject: 'New Contact Message - CallyGym',
      text: `Name: ${name}\nEmail: ${email}\nMessage:\n${message}`,
      html: `
        <h2>New Contact Message</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Message:</strong><br>${message.replace(/\n/g, '<br>')}</p>
      `,
    });

    res.status(200).json({ success: true, message: 'Message sent successfully!' });
  } catch (err) {
    console.error('Contact form error:', err);
    res.status(500).json({ success: false, message: 'Failed to send message. Please try again later.' });
  }
});

// Membership Upgrade with Paystack 
app.post('/api/membership/upgrade', async (req, res) => {
  const { plan } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.userId } });

  const amount = plan === 'Premium' ? 3000000 : 6000000;

  try {
    const response = await paystack.transaction.initialize({
      email: user.email,
      amount,
      metadata: { userId: user.id, plan },
    });

    res.json({ authorization_url: response.data.authorization_url });
  } catch (err) {
    res.status(500).json({ message: 'Payment failed' });
  }
});

app.post('/api/payment/initialize', async (req, res) => {
  const { planName, amountNaira, className, userDetails } = req.body;

  if (!userDetails?.email || !amountNaira || amountNaira < 1) {
    return res.status(400).json({ message: 'Missing or invalid payment details' });
  }

  try {
    const payload = {
      email: userDetails.email.trim(),
      amount: Math.round(amountNaira * 100),
      reference: `CallyGym-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      metadata: {
        name: userDetails.name || 'Anonymous',
        phone: userDetails.phone || '',
        message: userDetails.message || '',
        type: className ? 'class_booking' : 'membership',
        plan: planName || 'Unknown',
        className: className || null,
      },
    };
    const paystackResponse = await paystackClient.transaction.initialize(payload);

    if (!paystackResponse?.data?.authorization_url) {
      throw new Error('No authorization_url returned');
    }

    res.json({
      authorization_url: paystackResponse.data.authorization_url,
      reference: payload.reference,
    });
  } catch (err) {
    console.error('[PAYMENT ERROR FULL]', err);
    console.error('[PAYMENT ERROR RESPONSE]', err.response?.data || err.message);
    res.status(500).json({
      message: 'Payment initialization failed',
      details: err.response?.data?.message || err.message || 'Unknown error',
    });
  }
});

app.post('/api/free-trial', async (req, res) => {
  const { name, email, phone } = req.body;

  if (!name || !email || !phone) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    await prisma.freeTrial.create({
      data: {
        name,
        email,
        phone,
        createdAt: new Date(),
      },
    });

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
  connectionTimeout: 30000,  // 30 seconds
  greetingTimeout: 30000,
  socketTimeout: 30000,
    });

await transporter.sendMail({
  from: `"CallyGym" <${process.env.EMAIL_USER}>`,
  to: 'orurutestimony19@gmail.com',  
  replyTo: email, 
  subject: 'New Free Trial Request - CallyGym',
  text: `New free trial request:\n\nName: ${name}\nEmail: ${email}\nPhone: ${phone}\nSubmitted: ${new Date().toLocaleString('en-NG')}`,
  html: `
    <h2 style="color: #FF6B00;">New Free Trial Request</h2>
    <p><strong>Name:</strong> ${name}</p>
    <p><strong>Email:</strong> ${email}</p>
    <p><strong>Phone:</strong> ${phone}</p>
    <p><strong>Submitted:</strong> ${new Date().toLocaleString('en-NG')}</p>
    <hr>
    <p style="color: #666;">Reply to this email to contact the lead directly.</p>
  `,
});

    res.status(201).json({ message: 'Free trial request submitted' });
  } catch (err) {
    console.error('Free trial error:', err);
    res.status(500).json({ message: 'Failed to submit request' });
  }
});

app.post('/api/paystack/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const secret = process.env.PAYSTACK_SECRET_KEY; 
  
  const hash = crypto.createHmac('sha512', secret)
                     .update(JSON.stringify(req.body))
                     .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    return res.sendStatus(400);
  }

  const event = req.body;

  if (event.event === 'charge.success') {
    const data = event.data;
    const metadata = data.metadata; 

    try {
      await prisma.booking.create({
        data: {
          name: metadata.name || 'Unknown',
          email: metadata.email || data.customer.email,
          phone: metadata.phone || 'N/A',
          date: new Date(),
        },
      });

      console.log(`Booking saved from Paystack reference: ${data.reference}`);
    } catch (err) {
      console.error('Webhook save failed:', err);
    }
  }

  res.sendStatus(200);
});

// One-time table creation route 
app.get('/api/create-tables', async (req, res) => {
  try {
    console.log('Creating tables...');
    await prisma.$connect();

    // FreeTrial table (lowercase as per @@map("free_trials"))
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "free_trials" (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL
      );
    `;

    // Contact table (no @@map, so "Contact")
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "Contact" (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        message TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Booking table (no @@map, so "Booking")
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS "Booking" (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        date TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `;

    console.log('Tables created successfully');
    res.send('Tables created successfully! You can now use the forms.');
  } catch (err) {
    console.error('Table creation error:', err);
    res.status(500).send('Failed to create tables: ' + err.message);
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});