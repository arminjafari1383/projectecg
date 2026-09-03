export default function Maintenance() {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        background: "#f8fafc",
        color: "#1e293b",
        padding: "20px",
      }}
    >
      <div style={{ fontSize: "60px" }}>
        🔧
      </div>

      <h1>
        System Under Maintenance
      </h1>

      <p style={{ fontSize: "18px", color: "#64748b" }}>
        We are currently updating our system to provide you with a better experience.
      </p>

      <p style={{ fontSize: "16px", color: "#94a3b8" }}>
        Please check back soon.
      </p>
    </div>
  );
}