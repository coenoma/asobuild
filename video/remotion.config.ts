import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setPixelFormat('yuv420p');
Config.setCodec('h264');
Config.setCrf(18);
// メモリが 16GB しかない機械で回すので、並列は控えめにする。
// 上げるとヘッドレス Chromium が素材の読み込みで詰まって描画が止まる
// （CLAUDE.md「長時間プロセスの管理」）。
Config.setConcurrency(3);
Config.setOverwriteOutput(true);
