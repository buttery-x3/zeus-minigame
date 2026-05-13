import { ZeusGame } from "./game/ZeusGame";
import "./style.css";

const game = new ZeusGame();

if (import.meta.env.DEV) {
  (window as Window & { __ZEUS_GAME__?: ZeusGame }).__ZEUS_GAME__ = game;
}
