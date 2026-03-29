import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";

export default function LoginScreen() {
  const { login, devLogin } = useAuth();
  const [devErr, setDevErr] = useState("");

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="max-w-md w-full mx-4">
        <div className="bg-gray-800 rounded-2xl shadow-2xl p-8 border border-gray-700">
          <div className="text-center mb-8">
            <div className="text-6xl mb-4">🧹</div>
            <h1 className="text-3xl font-bold text-white mb-2">GroomPilot</h1>
            <p className="text-gray-400">
              AI-powered Agile Grooming & PR Review
            </p>
          </div>

          <div className="space-y-4">
            <div className="bg-gray-700/50 rounded-lg p-4 text-sm text-gray-300">
              <ul className="space-y-2">
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> Groom GitHub stories with AI
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> Generate scenarios, tests & subtasks
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> Review PRs against grooming specs
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> Real-time multi-user collaboration
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-400">✓</span> Email formatted summaries
                </li>
              </ul>
            </div>

            <button
              onClick={login}
              className="w-full flex items-center justify-center gap-3 bg-gray-900 hover:bg-black text-white py-3 px-6 rounded-lg border border-gray-600 hover:border-gray-500 transition-all font-medium"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              Sign in with GitHub
            </button>

            <div className="relative my-2">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-600"></div></div>
              <div className="relative flex justify-center text-xs"><span className="bg-gray-800 px-2 text-gray-500">or</span></div>
            </div>

            <button
              onClick={() => { setDevErr(""); devLogin().catch((e) => setDevErr(e.message)); }}
              className="w-full flex items-center justify-center gap-2 bg-indigo-700 hover:bg-indigo-600 text-white py-3 px-6 rounded-lg border border-indigo-500 transition-all font-medium"
            >
              🚀 Dev Login (skip OAuth)
            </button>
            {devErr && <p className="text-red-400 text-xs text-center">{devErr}</p>}
          </div>

          <p className="text-center text-xs text-gray-500 mt-6">
            Open source · No data stored on GitHub · MIT License
          </p>
        </div>
      </div>
    </div>
  );
}
