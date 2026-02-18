# App Store Connect Subscription Configuration Checklist

## Error: "Missing purchase request configuration"
## Cause: Subscriptions not properly configured in App Store Connect

### Required Steps (Must Complete ALL):

#### 1. Subscription Group Setup
- [ ] Go to App Store Connect → Your App → Subscriptions
- [ ] Click "+" to create a new Subscription Group
- [ ] Name it (e.g., "LoveLink Premium Subscriptions")
- [ ] Click "Create"
- [ ] **CRITICAL**: Assign the Reference Name (this creates the group ID internally)

#### 2. Add Subscriptions to the Group
For EACH subscription (`lovelink.premium.monthly` and `com.lovelink.premium.monthly`):

- [ ] Click the subscription group you just created
- [ ] Click "+" to add a subscription
- [ ] Enter Product ID: `lovelink.premium.monthly` (for monthly)
- [ ] **Subscription Duration**: Select "1 Month" (CRITICAL - must match product type)
- [ ] **Display Name**: Enter "Monthly Premium" (required)
- [ ] **Description**: Add a description (required)
- [ ] Click "Create"

- [ ] Repeat for yearly subscription:
  - Product ID: `com.lovelink.premium.monthly`
  - **Subscription Duration**: Select "1 Year" (CRITICAL!)
  - Display Name: "Yearly Premium"
  - Description: Add description

#### 3. Subscription Pricing
For EACH subscription:
- [ ] Click on the subscription
- [ ] Click "Subscription Pricing" section
- [ ] Click "+" to add pricing
- [ ] Select "United Kingdom" (or all territories)
- [ ] Set price: £3.99 (monthly) or £39.99 (yearly)
- [ ] Click "Next" and confirm
- [ ] **Verify pricing shows as "Ready to Submit"**

#### 4. Subscription Information (Required Fields)
For EACH subscription, fill in:
- [ ] **Subscription Display Name** (user-facing)
- [ ] **Description** (what the user gets)
- [ ] **App Name** (how it appears in settings)
- [ ] All required localizations

#### 5. Review Information (CRITICAL)
- [ ] Add a screenshot showing the subscription in your app
- [ ] Add review notes explaining what premium features unlock
- [ ] This is REQUIRED for subscriptions to be approved

#### 6. Submit for Review
- [ ] Click "Submit for Review" on EACH subscription
- [ ] **Status must change from "Ready to Submit" to "Waiting for Review"**
- [ ] You can test subscriptions while "Waiting for Review" status

#### 7. Verify Sandbox Tester Setup
- [ ] Go to "Users and Access" → "Sandbox Testers"
- [ ] Create a test account (if not exists)
- [ ] **On test device**: Settings → App Store → Sandbox Account
- [ ] Sign out of real Apple ID
- [ ] When testing, sign in with sandbox account email

### Common Issues That Cause This Error:

1. **Subscription Duration Not Set**
   - MUST specify duration (1 Month, 1 Year, etc.)
   - This is often missed and causes "Missing purchase request configuration"

2. **Pricing Not Configured**
   - Must have at least one territory with pricing

3. **Subscriptions Not in a Group**
   - All subscriptions MUST be in a subscription group
   - Cannot exist standalone

4. **Missing Required Metadata**
   - Display name and description are required
   - Without these, products won't load

5. **Not Submitted for Review**
   - Subscriptions showing "Ready to Submit" won't work
   - Must click "Submit for Review" to change to "Waiting for Review"

### After Completing Checklist:

1. **Wait 15-30 minutes** for App Store servers to sync
2. **Delete and reinstall the app** on test device
3. **Test again** with sandbox tester account
4. Products should now load and purchases should work

### Verification:
- Products should load (no more "Subscription Setup Pending" warning)
- Purchase should initiate StoreKit payment sheet
- Error should be replaced with actual Apple payment dialog
