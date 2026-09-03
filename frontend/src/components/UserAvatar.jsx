import React from "react";

export default function UserAvatar({
  username,
  firstName,
  photoUrl,
  size = 36
}) {
  const name =
    username ||
    firstName ||
    "U";

  const letter =
    name.replace("@", "").charAt(0).toUpperCase();

  return (
    <div
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: "50%",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background:
          "linear-gradient(135deg, #2aabee, #5865f2)",
        color: "#fff",
        fontWeight: 700,
        fontSize: size * 0.42,
        border: "2px solid rgba(255,255,255,.15)"
      }}
    >
      {photoUrl ? (
        <img
          src={photoUrl}
          alt={name}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block"
          }}
          onError={(e) => {
            e.currentTarget.style.display =
              "none";
          }}
        />
      ) : (
        letter
      )}
    </div>
  );
}