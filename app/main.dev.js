/* eslint global-require: 0 */

/**
 * This module executes inside of electron's main process. You can start
 * electron renderer process from here and communicate with the other processes
 * through IPC.
 *
 * When running `yarn build` or `yarn build-main`, this file is compiled to
 * `./app/main.prod.js` using webpack. This gives us some performance wins.
 *
 * @flow
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import ffmpegStatic from 'ffmpeg-static';
import ffprobleStatic from 'ffprobe-static';
import ffmpeg from 'fluent-ffmpeg';
import { platform } from 'os';
import MenuBuilder from './menu';

let mainWindow = null;

// if (process.env.NODE_ENV === 'production') {
//   const sourceMapSupport = require('source-map-support');
//   sourceMapSupport.install();
// }

if (
  process.env.NODE_ENV === 'development' ||
  process.env.DEBUG_PROD === 'true'
) {
  require('electron-debug')();
  const path = require('path');
  const p = path.join(__dirname, '..', 'app', 'node_modules');
  require('module').globalPaths.push(p);
}

const installExtensions = async () => {
  const installer = require('electron-devtools-installer');
  const forceDownload = !!process.env.UPGRADE_EXTENSIONS;
  const extensions = ['REACT_DEVELOPER_TOOLS', 'REDUX_DEVTOOLS'];

  return Promise.all(
    extensions.map(name => installer.default(installer[name], forceDownload))
  ).catch(console.log);
};

/**
 * Add event listeners...
 */

app.on('window-all-closed', () => {
  // Respect the OSX convention of having the application in memory even
  // after all windows have been closed
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('ready', async () => {
  if (
    process.env.NODE_ENV === 'development' ||
    process.env.DEBUG_PROD === 'true'
  ) {
    await installExtensions();
  }

  ffmpeg.setFfmpegPath(ffmpegStatic.path);
  ffmpeg.setFfprobePath(ffprobleStatic.path);

  mainWindow = new BrowserWindow({
    show: false,
    width: 700,
    height: 728
  });

  mainWindow.loadURL(`file://${__dirname}/app.html`);

  // @TODO: Use 'ready-to-show' event
  //        https://github.com/electron/electron/blob/master/docs/api/browser-window.md#using-ready-to-show-event
  mainWindow.webContents.on('did-finish-load', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();
});

ipcMain.on('videos:added', (event, videos) => {
  const videoPromises = videos.map(
    video =>
      new Promise((resolve, reject) => {
        ffmpeg.ffprobe(video.path, (err, metadata) => {
          if (err) {
            reject(err);
          }
          video.duration = metadata.format.duration;
          resolve(video);
        });
      })
  );

  Promise.all(videoPromises).then(results => {
    mainWindow.webContents.send('videos:meta:ready', results);
  });
});

ipcMain.on('folder:open', (event, outputPath) => {
  shell.showItemInFolder(outputPath);
});

ipcMain.on('conversion:start', (event, videos) => {
  videos.forEach(video => {
    const outputDirectory = video.path.split(video.name)[0];
    const outputName = video.name.split('.')[0];
    const outputPath = `${outputDirectory}${outputName}.${video.format}`;

    ffmpeg(video.path)
      .output(outputPath)
      .on('progress', ({ timemark }) =>
        mainWindow.webContents.send('conversion:progress', {
          videoPath: video.path,
          timemark
        })
      )
      .on('end', () => {
        mainWindow.webContents.send('conversion:end', {
          videoPath: video.path,
          outputPath
        });
      })
      .on('error', () => {
        mainWindow.webContents.send('conversion:error', {
          videoPath: video.path
        });
      })
      .run();
  });
});
