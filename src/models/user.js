subscription: {
  plan: {
    type: String,
    enum: ["free", "starter", "pro"],
    default: "free",
  },
  expiresAt: {
    type: Date,
    default: null,
  },
},

verified: {
  type: Boolean,
  default: false,subscription: {
  plan: {
    type: String,
    enum: ["free", "starter", "pro"],
    default: "free",
  },
  expiresAt: {
    type: Date,
    default: null,
  },
},

verified: {
  type: Boolean,
  default: false,
},

createdAt: {
  type: Date,
  default: Date.now,
},
},

createdAt: {
  type: Date,
  default: Date.now,
},