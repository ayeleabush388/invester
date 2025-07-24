const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

// Supabase config (replace with your own keys)
const supabase = createClient(
  "https://qzdryphhgvrbjxuwaplr.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6ZHJ5cGhoZ3ZyYmp4dXdhcGxyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTM4MTUwMiwiZXhwIjoyMDY2OTU3NTAyfQ.-hS7V9tppH9Ji89R9pJV2wFU-XdFBC9zEJpxHQsCsVM"
);

const MIN_INVEST = 400;
const MAX_INVEST = 4000;

// Signup
app.post("/api/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password are required" });

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: "Signup successful. Please check your email.", data });
});

// Login
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password are required" });

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: error.message });

  res.json({ session: data.session, user: data.user });
});

// Investment Request
app.post("/api/invest-request", async (req, res) => {
  const { user_id, amount, ft_code } = req.body;
  if (amount < MIN_INVEST || amount > MAX_INVEST)
    return res.status(400).json({ error: `Investment must be between ${MIN_INVEST} and ${MAX_INVEST} birr` });
  if (!ft_code || ft_code.length < 5)
    return res.status(400).json({ error: "FT code must be at least 5 characters" });

  const { error } = await supabase
    .from("investment_requests")
    .insert([{ user_id, amount, ft_code, status: "pending", requested_at: new Date().toISOString() }]);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ message: "Investment request submitted. Waiting for approval." });
});

// Get Pending Investment Requests (Admin)
app.get("/api/admin/invest-requests", async (req, res) => {
  const { data, error } = await supabase
    .from("investment_requests")
    .select("*")
    .eq("status", "pending");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Approve Investment Request (Admin)
app.post("/api/admin/approve-request", async (req, res) => {
  const { id, amount, user_id } = req.body;

  const { error: updateError } = await supabase
    .from("investment_requests")
    .update({ status: "approved" })
    .eq("id", id);
  if (updateError) return res.status(500).json({ error: updateError.message });

  // Update wallet balance
  const { data: wallet, error: walletError } = await supabase
    .from("wallets")
    .select("balance")
    .eq("user_id", user_id)
    .maybeSingle();
  if (walletError) return res.status(500).json({ error: walletError.message });

  if (wallet) {
    const { error: updateWalletError } = await supabase
      .from("wallets")
      .update({ balance: wallet.balance + amount })
      .eq("user_id", user_id);
    if (updateWalletError) return res.status(500).json({ error: updateWalletError.message });
  } else {
    const { error: insertWalletError } = await supabase
      .from("wallets")
      .insert([{ user_id, balance: amount }]);
    if (insertWalletError) return res.status(500).json({ error: insertWalletError.message });
  }

  res.json({ message: "Investment approved and wallet updated." });
});

// Reject Investment Request (Admin)
app.post("/api/admin/reject-request", async (req, res) => {
  const { id } = req.body;
  const { error } = await supabase
    .from("investment_requests")
    .update({ status: "rejected" })
    .eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "Request rejected." });
});

// Get Wallet Balance
app.get("/api/balance/:userId", async (req, res) => {
  const user_id = req.params.userId;
  const { data, error } = await supabase
    .from("wallets")
    .select("balance")
    .eq("user_id", user_id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ balance: data ? data.balance : 0 });
});

// Withdraw Request
app.post("/api/withdraw", async (req, res) => {
  const { user_id, amount } = req.body;
  if (amount < 200)
    return res.status(400).json({ error: "Minimum withdrawal amount is 200 birr" });

  // Get user wallet
  const { data: wallet, error: walletError } = await supabase
    .from("wallets")
    .select("balance")
    .eq("user_id", user_id)
    .maybeSingle();

  if (walletError) return res.status(500).json({ error: walletError.message });
  if (!wallet || wallet.balance < amount)
    return res.status(400).json({ error: "Insufficient balance" });

  // ✅ Immediately deduct the amount
  const { error: deductError } = await supabase
    .from("wallets")
    .update({ balance: wallet.balance - amount })
    .eq("user_id", user_id);

  if (deductError) return res.status(500).json({ error: deductError.message });

  // ✅ Then insert withdrawal request as pending
  const { error: insertError } = await supabase
    .from("withdrawals")
    .insert([{ user_id, amount, status: "pending", requested_at: new Date().toISOString() }]);
    
  if (insertError) return res.status(500).json({ error: insertError.message });

  res.json({ message: "Withdrawal request submitted and balance deducted immediately." });
});


// Get Withdrawals of User
app.get("/api/withdrawals/:userId", async (req, res) => {
  const user_id = req.params.userId;
  const { data, error } = await supabase
    .from("withdrawals")
    .select("*")
    .eq("user_id", user_id)
    .order("requested_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Admin Withdrawal Approval
// Just approve the status — no more wallet update
app.post("/api/admin/approve-withdrawal", async (req, res) => {
  const { id } = req.body;

  const { error: updateError } = await supabase
    .from("withdrawals")
    .update({ status: "approved" })
    .eq("id", id);

  if (updateError) return res.status(500).json({ error: updateError.message });

  res.json({ message: "Withdrawal approved." });
});


app.post("/api/admin/reject-withdrawal", async (req, res) => {
  const { id } = req.body;
  const { error } = await supabase
    .from("withdrawals")
    .update({ status: "rejected" })
    .eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "Withdrawal rejected." });
});

// LEVEL INVESTMENT (for completeness)
// ✅ Activate Level Investment
app.post("/api/level-invest", async (req, res) => {
  const { user_id, level } = req.body;

  const levelConfigs = {
    1: { amount: 500 },
    2: { amount: 1500 },
    3: { amount: 2000 },
    4: { amount: 3000 },
  };

  const config = levelConfigs[level];
  if (!config) return res.status(400).json({ error: "Invalid level selected." });

  // Get user wallet
  const { data: wallet, error: walletErr } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", user_id)
    .maybeSingle();

  if (walletErr || !wallet)
    return res.status(400).json({ error: "User wallet not found." });

  if (wallet.balance < config.amount)
    return res.status(400).json({ error: "Insufficient balance to activate this level." });

  // Check if user already activated this level
  const { data: existing } = await supabase
    .from("level_investments")
    .select("*")
    .eq("user_id", user_id)
    .eq("level", level)
    .maybeSingle();

  if (existing)
    return res.status(400).json({ error: "You have already activated this level." });

  // Deduct wallet
  const { error: deductError } = await supabase
    .from("wallets")
    .update({ balance: wallet.balance - config.amount })
    .eq("user_id", user_id);

  if (deductError)
    return res.status(500).json({ error: deductError.message });

  // Insert level investment
  const { error: insertError } = await supabase
    .from("level_investments")
    .insert([{
      user_id,
      level,
      invested_amount: config.amount,
      daily_profit: config.amount * 0.1,
      start_date: new Date().toISOString(),
      days_remaining: 30,
    }]);

  if (insertError)
    return res.status(500).json({ error: insertError.message });

  res.json({ message: `Level ${level} activated. You will earn 10% daily for 30 days.` });
});




// ✅ Distribute Daily Profit — Call this manually or set as CRON job
app.post("/api/distribute-daily-profit", async (req, res) => {
  const { data: activeLevels, error } = await supabase
    .from("level_investments")
    .select("*")
    .gt("days_remaining", 0);

  if (error)
    return res.status(500).json({ error: error.message });

  for (const entry of activeLevels) {
    // Add profit to wallet
    await supabase.rpc("increment_wallet_balance", {
      uid: entry.user_id,
      amt: entry.daily_profit,
    });

    // Decrease remaining days
    await supabase
      .from("level_investments")
      .update({ days_remaining: entry.days_remaining - 1 })
      .eq("id", entry.id);
  }

  res.json({ message: "Daily profit distributed to all active level investors." });
});


// ------------- LOAN LOGIC --------------

// Request Loan (only 80% of wallet allowed)
app.post("/api/request-loan", async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: "User ID is required" });

  // Check if user has pending loan
  const { data: pendingLoans, error: pendingError } = await supabase
    .from("loans")
    .select("*")
    .eq("user_id", user_id)
    .eq("status", "pending");
  if (pendingError) return res.status(500).json({ error: pendingError.message });
  if (pendingLoans.length > 0)
    return res.status(400).json({ error: "You already have a pending loan request." });

  // Get wallet balance
  const { data: wallet, error: walletError } = await supabase
    .from("wallets")
    .select("balance")
    .eq("user_id", user_id)
    .maybeSingle();
  if (walletError) return res.status(500).json({ error: walletError.message });

  if (!wallet || wallet.balance <= 0)
    return res.status(400).json({ error: "You have no balance to request loan." });

  const loanAmount = Math.floor(wallet.balance * 0.8);

  if (loanAmount < 1) return res.status(400).json({ error: "Loan amount too small." });

  // Insert loan request
  const { error: insertError } = await supabase
    .from("loans")
    .insert([{ user_id, amount: loanAmount, status: "pending", requested_at: new Date().toISOString() }]);
  if (insertError) return res.status(500).json({ error: insertError.message });

  res.json({ message: `Loan request of ${loanAmount} birr submitted.` });
});

// Get pending loans (for frontend to check)
app.get("/api/pending-loans", async (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).json({ error: "User ID required" });

  const { data, error } = await supabase
    .from("loans")
    .select("*")
    .eq("user_id", user_id)
    .eq("status", "pending");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Admin: Get all loan requests
app.get("/api/admin/loan-requests", async (req, res) => {
  const { data, error } = await supabase
    .from("loans")
    .select("*")
    .eq("status", "pending");
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Admin: Approve loan
app.post("/api/admin/approve-loan", async (req, res) => {
  const { id, user_id, amount } = req.body;

  // Update loan status to approved
  const { error: updateError } = await supabase
    .from("loans")
    .update({ status: "approved" })
    .eq("id", id);
  if (updateError) return res.status(500).json({ error: updateError.message });

  // Add loan amount to wallet
  const { data: wallet, error: walletError } = await supabase
    .from("wallets")
    .select("balance")
    .eq("user_id", user_id)
    .maybeSingle();
  if (walletError) return res.status(500).json({ error: walletError.message });

  if (wallet) {
    const { error: updateWalletError } = await supabase
      .from("wallets")
      .update({ balance: wallet.balance + amount })
      .eq("user_id", user_id);
    if (updateWalletError) return res.status(500).json({ error: updateWalletError.message });
  } else {
    const { error: insertWalletError } = await supabase
      .from("wallets")
      .insert([{ user_id, balance: amount }]);
    if (insertWalletError) return res.status(500).json({ error: insertWalletError.message });
  }

  res.json({ message: "Loan approved and amount added to wallet." });
});

// Admin: Reject loan
app.post("/api/admin/reject-loan", async (req, res) => {
  const { id } = req.body;
  const { error } = await supabase
    .from("loans")
    .update({ status: "rejected" })
    .eq("id", id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: "Loan request rejected." });
});


const path = require("path");

// Serve static files from the frontend folder
app.use(express.static(path.join(__dirname, "frontend")));

// Serve admin.html on /admin route
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "frontend", "admin.html"));
});

// Start server
const PORT = 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

