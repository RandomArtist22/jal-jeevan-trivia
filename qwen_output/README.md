# 🌊 Jal Jeevan KBC Quiz

A **KBC-type quiz website** with a beautiful water/flow theme, designed for the Jal Jeevan event. Features real-time multiplayer gameplay using WebSockets.

## ✨ Features

- **🎮 KBC-Style Gameplay**: Progressive quiz with increasing prize amounts
- **⚡ Fastest Finger First**: Quick response round with local time synchronization
- **👥 Real-time Multiplayer**: WebSocket-based communication for instant updates
- **📊 Live Leaderboard**: Real-time score tracking and rankings
- **🎯 50:50 Lifeline**: Host can use lifelines to help players
- **💧 Water/Flow Theme**: Beautiful aquatic UI inspired by [Pravah 26](https://pravah26.netlify.app/)
- **📱 Responsive Design**: Works on desktop, tablet, and mobile devices
- **🌐 Offline-Ready**: Works on local network without internet

## 🚀 Quick Start

### Prerequisites

- Node.js (v14 or higher)
- npm

### Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```

3. **Access the application:**
   - **Home Page**: http://localhost:3000
   - **Host Dashboard**: http://localhost:3000/host
   - **Participant Dashboard**: http://localhost:3000/participant

## 🎮 How to Play

### For Host (Quiz Master)

1. Open http://localhost:3000/host
2. The host is automatically registered when connecting
3. **Game Flow:**
   - **Lobby**: Wait for players to register
   - **Start Fastest Finger First**: Begin the quick response round
   - **End Fastest Finger**: Show results and select top players
   - **Start Quiz**: Begin the main KBC-style quiz
   - **Next Question**: Move to the next question
   - **Use 50:50 Lifeline**: Remove 2 wrong options
   - **End Quiz**: Finish the quiz and show final leaderboard
   - **Reset Game**: Start fresh with all players

### For Participants

1. Open http://localhost:3000/participant
2. Enter your name and optional team name
3. Click "Join Quiz" to register
4. Wait for the host to start the quiz
5. Answer questions within the time limit
6. View your score and leaderboard

## 🏗️ Network Setup for Event

### Host Laptop Setup

1. **Connect to private router:**
   - Connect the host laptop to the private router via WiFi or Ethernet

2. **Find local IP address:**
   ```bash
   # Linux/Mac
   ip addr show | grep inet
   
   # Windows
   ipconfig
   ```
   Look for an IP like `192.168.1.x` or `10.0.0.x`

3. **Start the server:**
   ```bash
   npm start
   ```
   
4. **Note the server URL:**
   - If your IP is `192.168.1.100`, the server will be at:
     - Host: `http://192.168.1.100:3000/host`
     - Participant: `http://192.168.1.100:3000/participant`

### Participant Devices

1. **Connect to the same router:**
   - All participants connect their devices to the private router's WiFi

2. **Access the quiz:**
   - Open browser and go to: `http://<HOST_IP>:3000/participant`
   - Example: `http://192.168.1.100:3000/participant`

## 📁 Project Structure

```
jal-jevan-kbc-quiz/
├── server.js                 # Node.js + Express + Socket.IO server
├── package.json              # Dependencies and scripts
├── README.md                 # This file
└── public/                   # Frontend files
    ├── index.html            # Home page
    ├── host.html             # Host dashboard
    ├── participant.html      # Participant dashboard
    ├── css/
    │   └── style.css         # Water/flow themed styles
    └── js/
        ├── main.js           # Home page scripts
        ├── host.js           # Host dashboard scripts
        └── participant.js    # Participant dashboard scripts
```

## 🎨 Design Features

### Water/Flow Theme
- **Color Palette**: Deep ocean blues, teals, and cyan accents
- **Animations**: 
  - Flowing wave backgrounds
  - Ripple effects on buttons
  - Smooth transitions and hover effects
  - Animated water drops
- **Typography**: Modern Poppins font family
- **UI Elements**: Card-based layouts with glowing borders

### KBC Elements
- **Prize Money**: Progressive from ₹1,000 to ₹3,20,000
- **Timer**: Visual countdown circle with color changes
- **Options**: A, B, C, D format with hover effects
- **Lifelines**: 50:50 to remove wrong options
- **Leaderboard**: Ranked with gold, silver, bronze medals

## 🔧 Configuration

### Changing Quiz Questions

Edit the `defaultQuestions` array in `server.js`:

```javascript
const defaultQuestions = [
  {
    id: 1,
    question: "Your question here?",
    options: ["Option A", "Option B", "Option C", "Option D"],
    correct: 1,  // Index of correct answer (0-3)
    prize: 1000, // Prize amount
    timeLimit: 30 // Time limit in seconds
  },
  // ... more questions
];
```

### Changing Port

Set the PORT environment variable:

```bash
PORT=8080 npm start
```

### Customizing Theme

Edit CSS variables in `public/css/style.css`:

```css
:root {
  --color-primary: #0EA5E9;
  --color-accent: #06B6D4;
  --color-teal: #14B8A6;
  /* ... more variables */
}
```

## 🎯 Fastest Finger First

The Fastest Finger First round uses **local time synchronization**:
- Client timestamp is captured when answering
- Server validates the timestamp (within 5 seconds tolerance)
- Players are ranked by correctness and speed
- Top performers can be selected for the main quiz

## 🔐 Security Notes

- This is designed for **offline, local network use**
- No authentication required (open access on local network)
- Not intended for production internet use
- All communication stays within the local network

## 🐛 Troubleshooting

**Server won't start:**
```bash
# Check if port 3000 is in use
lsof -i :3000
# Kill the process
kill -9 <PID>
```

**Participants can't connect:**
- Ensure all devices are on the same network
- Check firewall settings on host machine
- Verify the host IP address is correct

**WebSocket connection fails:**
- Check browser console for errors
- Ensure Socket.IO is properly installed
- Try refreshing the page

## 📝 License

This project is created for the Jal Jeevan event.

## 🙏 Credits

- Design inspiration: [Pravah 26](https://pravah26.netlify.app/)
- Font: Poppins (Google Fonts)
- Technology: Node.js, Express, Socket.IO

---

**Made with 💧 for Jal Jeevan Event 2026**
