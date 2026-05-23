import React, { useState } from "react";
import { 
  Text, 
  View, 
  StyleSheet, 
  TouchableOpacity, 
  TextInput, 
  ActivityIndicator, 
  ScrollView,
  Platform
} from "react-native";
import { ConvexReactClient, Authenticated, Unauthenticated, AuthLoading } from "convex/react";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";

// Resolve environment variable from Expo bundler
const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

if (!convexUrl || convexUrl.includes("YOUR-CONVEX-DEPLOYMENT")) {
  console.warn(
    "Warning: EXPO_PUBLIC_CONVEX_URL is not configured properly. " +
    "Verify environment variables in Cloudflare."
  );
}

const convex = new ConvexReactClient(convexUrl || "https://placeholder-fallback.convex.cloud");

export default function App() {
  return (
    // ConvexAuthProvider replaces the standard ConvexProvider for Auth capabilities
    <ConvexAuthProvider client={convex}>
      
      <AuthLoading>
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#3b82f6" />
          <Text style={styles.loadingText}>Loading Giga3 AI...</Text>
        </View>
      </AuthLoading>

      <Authenticated>
        {/* Shows ONLY when logged in */}
        <DashboardView />
      </Authenticated>

      <Unauthenticated>
        {/* Shows ONLY when logged out */}
        <LandingPageView />
      </Unauthenticated>

    </ConvexAuthProvider>
  );
}

// ====================================================================
// 1. LANDING PAGE & LOGIN COMPONENT
// ====================================================================
function LandingPageView() {
  const { signIn } = useAuthActions();
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"credentials" | "verify">("credentials");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const handleEmailAuth = async () => {
    if (!email) return setErrorMsg("Please enter a valid email address.");
    setErrorMsg("");
    setLoading(true);
    try {
      if (step === "credentials") {
        await signIn("resend", { email });
        setStep("verify");
      } else {
        await signIn("resend", { email, code });
      }
    } catch (err: any) {
      setErrorMsg(err.message || "An authentication error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setErrorMsg("");
    try {
      await signIn("google");
    } catch (err: any) {
      setErrorMsg(err.message || "Google Authentication failed.");
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.scrollContainer}>
      <View style={styles.navbar}>
        <Text style={styles.logoText}>Giga3 AI</Text>
      </View>

      <View style={styles.heroSection}>
        <Text style={styles.heroTitle}>The Future Is African</Text>
        <Text style={styles.heroSubtitle}>
          The premier AI-powered creator, student, and productivity application engine.
        </Text>
      </View>

      <View style={styles.authCard}>
        <Text style={styles.cardTitle}>
          {step === "credentials" ? "Create Account or Sign In" : "Verify Your Email"}
        </Text>
        
        {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

        {step === "credentials" ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="Enter your email (e.g., ayiiga3@gmail.com)"
              placeholderTextColor="#64748b"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <TouchableOpacity 
              style={[styles.primaryButton, loading && styles.disabledButton]} 
              onPress={handleEmailAuth}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Continue with Email</Text>}
            </TouchableOpacity>

            <View style={styles.dividerContainer}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity style={styles.googleButton} onPress={handleGoogleAuth}>
              <Text style={styles.googleButtonText}>Continue with Google 🚀</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.infoText}>We sent a verification code to {email}.</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter 6-digit OTP Code"
              placeholderTextColor="#64748b"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
            />
            <TouchableOpacity style={styles.primaryButton} onPress={handleEmailAuth}>
              <Text style={styles.buttonText}>Verify & Open Dashboard</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setStep("credentials")}>
              <Text style={styles.backLink}>Back to email input</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScrollView>
  );
}

// ====================================================================
// 2. SECURE DASHBOARD COMPONENT
// ====================================================================
function DashboardView() {
  const { signOut } = useAuthActions();

  return (
    <View style={styles.dashboardContainer}>
      <View style={styles.sidebar}>
        <Text style={styles.sidebarLogo}>Giga3 Console</Text>
        <View style={styles.navItems}>
          <Text style={[styles.navItem, styles.navItemActive]}>⚡ Workspace</Text>
          <Text style={styles.navItem}>📁 Projects</Text>
          <Text style={styles.navItem}>💳 Credits & Billing</Text>
        </View>
        <TouchableOpacity style={styles.logoutButton} onPress={() => signOut()}>
          <Text style={styles.logoutButtonText}>Log Out</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.mainContent}>
        <Text style={styles.dashboardTitle}>Welcome to your Workspace</Text>
        <Text style={styles.dashboardSubtitle}>You have successfully logged in via Convex Auth.</Text>
        
        <View style={styles.statsRow}>
          <View style={styles.statCard}><Text style={styles.statVal}>Active</Text><Text style={styles.statLabel}>Account Status</Text></View>
          <View style={styles.statCard}><Text style={styles.statVal}>Convex</Text><Text style={styles.statLabel}>Database Connected</Text></View>
        </View>
      </View>
    </View>
  );
}

// ====================================================================
// 3. STYLESHEET
// ====================================================================
const styles = StyleSheet.create({
  centerContainer: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#0f172a" },
  loadingText: { color: "#94a3b8", marginTop: 12, fontSize: 15 },
  scrollContainer: { flexGrow: 1, backgroundColor: "#0f172a", paddingBottom: 40 },
  navbar: { height: 70, borderBottomWidth: 1, borderBottomColor: "#1e293b", justifyContent: "center", paddingHorizontal: 40 },
  logoText: { fontSize: 22, fontWeight: "bold", color: "#3b82f6" },
  heroSection: { alignItems: "center", marginTop: 60, paddingHorizontal: 20 },
  heroTitle: { fontSize: 36, fontWeight: "800", color: "#ffffff", marginBottom: 15, textAlign: "center" },
  heroSubtitle: { fontSize: 16, color: "#94a3b8", maxWidth: 600, textAlign: "center", lineHeight: 24 },
  authCard: { backgroundColor: "#1e293b", alignSelf: "center", marginTop: 40, width: "90%", maxWidth: 420, borderRadius: 12, padding: 32, borderWidth: 1, borderColor: "#334155" },
  cardTitle: { fontSize: 20, fontWeight: "700", color: "#ffffff", marginBottom: 24, textAlign: "center" },
  input: { backgroundColor: "#0f172a", borderWidth: 1, borderColor: "#334155", borderRadius: 8, padding: 14, color: "#ffffff", fontSize: 15, marginBottom: 16 },
  primaryButton: { backgroundColor: "#3b82f6", borderRadius: 8, padding: 14, alignItems: "center" },
  disabledButton: { opacity: 0.6 },
  buttonText: { color: "#ffffff", fontWeight: "600", fontSize: 15 },
  dividerContainer: { flexDirection: "row", alignItems: "center", marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#334155" },
  dividerText: { color: "#64748b", marginHorizontal: 12, fontSize: 12, fontWeight: "600" },
  googleButton: { backgroundColor: "#ffffff", borderRadius: 8, padding: 14, alignItems: "center" },
  googleButtonText: { color: "#0f172a", fontWeight: "600", fontSize: 15 },
  errorText: { color: "#ef4444", fontSize: 14, marginBottom: 16, textAlign: "center" },
  infoText: { color: "#94a3b8", fontSize: 14, marginBottom: 16, textAlign: "center" },
  backLink: { color: "#3b82f6", fontSize: 14, marginTop: 16, textAlign: "center" },
  
  // Dashboard Styles
  dashboardContainer: { flex: 1, flexDirection: Platform.OS === "web" ? "row" : "column", backgroundColor: "#0f172a" },
  sidebar: { width: Platform.OS === "web" ? 260 : "100%", backgroundColor: "#1e293b", padding: 24, borderRightWidth: 1, borderRightColor: "#334155", justifyContent: "space-between" },
  sidebarLogo: { fontSize: 20, fontWeight: "800", color: "#ffffff", marginBottom: 32 },
  navItems: { flex: 1 },
  navItem: { color: "#94a3b8", fontSize: 15, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 6, marginBottom: 8 },
  navItemActive: { backgroundColor: "#0f172a", color: "#3b82f6", fontWeight: "600" },
  logoutButton: { backgroundColor: "#334155", padding: 12, borderRadius: 6, alignItems: "center", marginTop: 20 },
  logoutButtonText: { color: "#f8fafc", fontWeight: "600" },
  mainContent: { flex: 1, padding: 40 },
  dashboardTitle: { fontSize: 28, fontWeight: "700", color: "#ffffff", marginBottom: 8 },
  dashboardSubtitle: { fontSize: 15, color: "#94a3b8", marginBottom: 32 },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: 16 },
  statCard: { backgroundColor: "#1e293b", padding: 24, borderRadius: 8, minWidth: 200, flex: 1, borderWidth: 1, borderColor: "#334155" },
  statVal: { fontSize: 24, fontWeight: "700", color: "#ffffff" },
  statLabel: { color: "#64748b", fontSize: 13, marginTop: 4, fontWeight: "500" }
});