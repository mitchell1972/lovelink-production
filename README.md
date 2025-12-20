# LoveLink - Production App

A couples connection app built with React Native/Expo and Supabase.

## Features

- 🔐 **Authentication** - Email/password signup and login with Supabase Auth
- 🔗 **Partner Linking** - Unique invite codes to connect partners
- 🎯 **Daily Sessions** - Mood check-ins, appreciation prompts, micro-plans
- 🖼️ **Moments** - Shared photo gallery with real-time sync
- 💓 **Pulse** - Send heartbeat "I'm thinking of you" signals
- 📅 **Plans** - Collaborative date planning with confirmations
- 🔔 **Real-time** - Live updates when partner responds

## Tech Stack

- **Frontend**: React Native + Expo
- **Backend**: Supabase (PostgreSQL + Auth + Storage + Realtime)
- **State**: React Context API

## Setup Instructions

### 1. Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Wait for the project to finish setting up

### 2. Run Database Schema

1. In your Supabase dashboard, go to **SQL Editor**
2. Copy the contents of `supabase-schema.sql`
3. Paste and run in the SQL Editor
4. This creates all tables, policies, and functions

### 3. Create Storage Buckets

In Supabase dashboard, go to **Storage** and create these buckets:

- `avatars` - For user profile pictures (public)
- `moments` - For shared photos (public)

Set both buckets to **Public** in their policies.

### 4. Configure App

1. Go to **Settings > API** in your Supabase dashboard
2. Copy your **Project URL** and **anon/public key**
3. Open `src/config/supabase.js`
4. Replace the placeholder values:

```javascript
const SUPABASE_URL = 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = 'your-anon-key-here';
```

### 5. Install Dependencies

```bash
npm install
```

### 6. Run the App

```bash
npx expo start
```

Scan the QR code with Expo Go app on your phone.

## Project Structure

```
lovelink-prod/
├── App.js                    # Main app entry point
├── package.json              # Dependencies
├── supabase-schema.sql       # Database schema
├── src/
│   ├── config/
│   │   └── supabase.js       # Supabase client config
│   ├── contexts/
│   │   └── AuthContext.js    # Auth state management
│   ├── services/
│   │   ├── authService.js    # Authentication API
│   │   ├── profileService.js # User profiles
│   │   ├── partnerService.js # Partner linking
│   │   ├── sessionService.js # Daily rituals
│   │   ├── momentsService.js # Photo sharing
│   │   ├── plansService.js   # Date planning
│   │   └── pulseService.js   # Heartbeat feature
│   ├── screens/
│   │   ├── SignUpScreen.js
│   │   ├── LoginScreen.js
│   │   ├── LinkPartnerScreen.js
│   │   └── HomeScreen.js
│   └── components/
│       └── ui.js             # Reusable UI components
```

## Database Schema

### Tables

- **profiles** - User profiles (extends Supabase auth)
- **partner_codes** - Unique invite codes for linking
- **partnerships** - Connected couples
- **sessions** - Daily ritual responses
- **moments** - Shared photos
- **plans** - Collaborative date plans
- **pulses** - "Thinking of you" signals

### Security

All tables use Row Level Security (RLS) policies:
- Users can only access their own data
- Partners can see each other's shared data
- Codes can be validated by anyone but only used once

## Environment Variables (Optional)

For production builds, use environment variables:

```bash
# .env
EXPO_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Then update `supabase.js`:

```javascript
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
```

## Next Steps

1. **Add remaining screens** - Session, Moments, Pulse, Plans, Premium
2. **Push notifications** - Notify when partner responds
3. **Premium features** - In-app purchases with RevenueCat
4. **Analytics** - Track engagement with Mixpanel/Amplitude
5. **Error tracking** - Add Sentry for crash reporting

## License

MIT
