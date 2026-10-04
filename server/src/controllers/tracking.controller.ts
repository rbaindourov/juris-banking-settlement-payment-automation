import { Request, Response } from 'express';
import { Claimant } from '../models/Claimant';
import { config } from '../config/env';

// 43-byte static 1x1 transparent GIF buffer
const TRANSPARENT_1X1_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64'
);

const TOKEN_REGEX = /^[a-f0-9]{64}$/i;

export class TrackingController {
  /**
   * GET /api/public/tracking/pixel/:token
   * Serves an in-memory 43-byte 1x1 transparent GIF.
   * Uniform response returned regardless of token validity to prevent token enumeration.
   */
  public static async handlePixel(req: Request, res: Response): Promise<void> {
    const token = String(req.params.token || '');

    // Send GIF headers immediately
    res.writeHead(200, {
      'Content-Type': 'image/gif',
      'Content-Length': TRANSPARENT_1X1_GIF.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    res.end(TRANSPARENT_1X1_GIF);

    // Asynchronously record engagement if token format is valid
    if (token && TOKEN_REGEX.test(token)) {
      try {
        await Claimant.updateOne(
          { paymentSelectionToken: token, emailOpened: { $ne: true } },
          {
            $set: {
              emailOpened: true,
              emailOpenedAt: new Date()
            }
          }
        );
      } catch (err: any) {
        console.error(`[TrackingPixel] Error updating open status for token ${token.substring(0, 8)}...`, err.message);
      }
    }
  }

  /**
   * GET /api/public/tracking/click/:token
   * Records click engagement and issues a 302 redirect to the client claim portal.
   */
  public static async handleClick(req: Request, res: Response): Promise<void> {
    const token = String(req.params.token || '');

    if (!token || !TOKEN_REGEX.test(token)) {
      res.redirect(302, `${config.CLIENT_URL}/claim/invalid`);
      return;
    }

    try {
      const claimant = await Claimant.findOne({ paymentSelectionToken: token }).select(
        '_id linkClicked linkClickedAt emailOpened emailOpenedAt'
      );

      if (!claimant) {
        res.redirect(302, `${config.CLIENT_URL}/claim/invalid`);
        return;
      }

      let modified = false;
      const now = new Date();

      if (!claimant.linkClicked) {
        claimant.linkClicked = true;
        claimant.linkClickedAt = now;
        modified = true;
      }

      if (!claimant.emailOpened) {
        claimant.emailOpened = true;
        claimant.emailOpenedAt = now;
        modified = true;
      }

      if (modified) {
        await claimant.save();
      }

      res.redirect(302, `${config.CLIENT_URL}/claim/${encodeURIComponent(token)}`);
    } catch (err: any) {
      console.error(`[TrackingClick] Error updating click status for token ${token.substring(0, 8)}...`, err.message);
      res.redirect(302, `${config.CLIENT_URL}/claim/${encodeURIComponent(token)}`);
    }
  }
}
