import { useState } from "react";
import { Shield, Unlock } from "lucide-react";
import { API_BASE } from "../../utils/config";

export function AdminLoginModal({ onClose, onSuccess, color, gradient }) {
    const [pin, setPin] = useState("");
    const [error, setError] = useState("");
    const [shake, setShake] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async () => {
        setLoading(true);
        try {
            const res = await fetch(`${API_BASE}/auth`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pin }),
            });
            const data = await res.json();
            if (data.success) {
                onSuccess(data.token, data.timeout);
                onClose();
            } else {
                setError("Invalid PIN. Please try again.");
                setShake(true); setPin("");
                setTimeout(() => setShake(false), 500);
            }
        } catch {
            setError("Server error. Is the backend running?");
            setShake(true);
            setTimeout(() => setShake(false), 500);
        }
        setLoading(false);
    };

    const handleKeyDown = (e) => {
        if (e.key === "Enter" && pin.length > 0) handleSubmit();
        if (e.key === "Escape") onClose();
    };

    return (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200 }} onClick={onClose}>
            <div onClick={e => e.stopPropagation()}
                style={{
                    background: "#161628", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 18, padding: 32, width: 360,
                    animation: shake ? "shakeX 0.4s ease-in-out" : "fadeIn 0.2s ease-out"
                }}>
                <style>{`
          @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
          @keyframes shakeX { 0%,100% { transform: translateX(0); } 20%,60% { transform: translateX(-8px); } 40%,80% { transform: translateX(8px); } }
        `}</style>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20 }}>
                    <div style={{ width: 52, height: 52, borderRadius: 14, background: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <Shield size={24} color="#fff" />
                    </div>
                </div>
                <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 700, color: "#fff", textAlign: "center" }}>Admin Access</h3>
                <p style={{ margin: "0 0 20px", fontSize: 12, color: "rgba(255,255,255,0.35)", textAlign: "center" }}>Enter your PIN to add or modify records</p>

                <input
                    type="password" inputMode="numeric" maxLength={6} autoFocus value={pin}
                    onChange={e => { setPin(e.target.value.replace(/\D/g, "")); setError(""); }}
                    onKeyDown={handleKeyDown}
                    placeholder="• • • •"
                    style={{
                        width: "100%", padding: "14px 16px", background: "rgba(255,255,255,0.05)", border: `1.5px solid ${error ? "#F87171" : "rgba(255,255,255,0.1)"}`,
                        borderRadius: 10, color: "#fff", fontSize: 22, outline: "none", boxSizing: "border-box", textAlign: "center",
                        fontFamily: "'Space Mono', monospace", letterSpacing: 8, transition: "border-color 0.2s"
                    }}
                    onFocus={e => { if (!error) e.target.style.borderColor = `${color}60`; }}
                    onBlur={e => { if (!error) e.target.style.borderColor = "rgba(255,255,255,0.1)"; }}
                />
                {error && <div style={{ fontSize: 11, color: "#F87171", textAlign: "center", marginTop: 8, fontWeight: 500 }}>{error}</div>}

                <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                    <button onClick={onClose} style={{ flex: 1, padding: 11, borderRadius: 9, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Cancel</button>
                    <button onClick={handleSubmit} disabled={pin.length < 4}
                        style={{ flex: 1, padding: 11, borderRadius: 9, border: "none", background: pin.length >= 4 ? `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})` : "rgba(255,255,255,0.06)", color: pin.length >= 4 ? "#fff" : "rgba(255,255,255,0.2)", cursor: pin.length >= 4 ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 600, transition: "all 0.2s" }}>
                        <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}><Unlock size={13} /> Unlock</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
