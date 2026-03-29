import { useEffect, useRef } from "react";
import { Routes, Route, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import LoginScreen from "./components/LoginScreen";
import Layout from "./components/Layout";

function OAuthCallback() {
  const [searchParams] = useSearchParams();
  const { handleCallback } = useAuth();
  const navigate = useNavigate();
  const calledRef = useRef(false);

  useEffect(() => {
    const code = searchParams.get("code");
    if (code && !calledRef.current) {
      calledRef.current = true;
      handleCallback(code)
        .then(() => navigate("/", { replace: true }))
        .catch((err) => {
          console.error("OAuth callback failed:", err);
          navigate("/login", { replace: true });
        });
    }
  }, [searchParams, handleCallback, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
      <div className="text-center">
        <p className="text-sm uppercase tracking-[0.2em] text-gray-400 mb-2">GroomPilot</p>
        <div className="text-4xl mb-4 animate-spin">⏳</div>
        <p>Authenticating with GitHub...</p>
      </div>
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">
        <div className="text-center">
          <div className="text-5xl mb-4">🧹</div>
          <p>Loading GroomPilot...</p>
        </div>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/auth/callback" element={<OAuthCallback />} />
      <Route path="/login" element={<LoginScreen />} />
      <Route path="*" element={user ? <Layout /> : <LoginScreen />} />
    </Routes>
  );
}
