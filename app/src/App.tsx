import { Route, Routes } from "react-router-dom";
import { Setup } from "./screens/Setup.tsx";
import { Room } from "./screens/Room.tsx";
import { Report } from "./screens/Report.tsx";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Setup />} />
      <Route path="/session/:id" element={<Room />} />
      <Route path="/report/:id" element={<Report />} />
    </Routes>
  );
}
