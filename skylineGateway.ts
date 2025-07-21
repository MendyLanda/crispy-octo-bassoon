
/**
 * skylineGateway.ts
 * 
 * A modern, easy-to-use TypeScript wrapper for the Skylline Gateway SMS API.
 * This library abstracts away the legacy HTTP API details and provides a clean
 * interface for working with SIM slots, ports, and SMS forwarding webhooks.
 */

import axios from 'axios';

type PortID = string; // A unique identifier for a port+SIM slot, e.g. "1A", "2B"

/**
 * Represents a single SIM slot currently active on a device port.
 */
export interface SIMSlotInfo {
  /** Port identifier in the format "1A", "2B", etc. */
  port: PortID;

  /** SIM card phone number (if available) */
  sn?: string;

  /** ICCID number of the SIM card (if available) */
  iccid?: string;

  /** IMSI number of the SIM card (if available) */
  imsi?: string;

  /** Raw status string from the device (e.g., "3 OK") */
  status: string;
}

/**
 * Callbacks for monitoring activation of a specific SIM port.
 */
export interface ActivationCallbacks {
  /** Called when the SIM becomes active and registered on the network */
  onReady: (info: SIMSlotInfo) => void;

  /** Called when there is an error activating the SIM */
  onError: (err: Error) => void;

  /** Maximum time to wait for registration (in milliseconds). Default: 30000 */
  timeoutMs?: number;
}

/**
 * A class that wraps communication with the Skylline Gateway SMS device.
 * Use this class to query SIM status, activate a SIM slot, or configure SMS forwarding.
 */
export class SkylineGateway {
  /**
   * Create a new SkylineGateway client
   * @param baseUrl The base URL of the device (e.g., http://192.168.1.100)
   * @param username Login username for the device (usually "root")
   * @param password Login password for the device
   */
  constructor(
    private baseUrl: string,
    private username: string,
    private password: string
  ) {}

  private buildURL(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  /**
   * Fetch the current status for all active SIMs across all ports.
   * Includes SIM number, ICCID, IMSI, and port identifiers.
   * 
   * @returns Promise that resolves to an array of SIM slot information
   */
  async getAllSIMSlots(): Promise<SIMSlotInfo[]> {
    const url = this.buildURL('/goip_get_status.html');
    const response = await axios.get<{ status: SIMSlotInfo[] }>(url, {
      params: {
        username: this.username,
        password: this.password
      }
    });
    return response.data.status;
  }

  /**
   * Activates a given SIM port (e.g., "2A") and waits until it's registered.
   * This is typically used when rotating SIM cards from a SIM bank.
   * 
   * @param port The port to activate, e.g. "2B"
   * @param callbacks Callback functions for success, error, and timeout
   */
  async activatePort(
    port: PortID,
    callbacks: ActivationCallbacks
  ): Promise<void> {
    const switchUrl = this.buildURL('/goip_send_cmd.html');
    const command = {
      type: 'command',
      op: 'switch',
      ports: port
    };

    try {
      await axios.post(switchUrl, command, {
        params: {
          username: this.username,
          password: this.password
        },
        headers: { 'Content-Type': 'application/json;charset=utf-8' }
      });
    } catch (err) {
      callbacks.onError(new Error('Failed to send switch command'));
      return;
    }

    const timeout = callbacks.timeoutMs || 30000;
    const pollInterval = 3000;
    const start = Date.now();

    const poll = async (): Promise<void> => {
      try {
        const slots = await this.getAllSIMSlots();
        const target = slots.find((s) => s.port === port);
        if (target && target.status.startsWith('3')) {
          callbacks.onReady(target);
        } else if (Date.now() - start < timeout) {
          setTimeout(poll, pollInterval);
        } else {
          callbacks.onError(new Error('Timeout waiting for SIM to register'));
        }
      } catch (err) {
        callbacks.onError(new Error('Failed to poll SIM status'));
      }
    };

    poll();
  }

  /**
   * Sets the webhook URL for receiving incoming SMS messages from the device.
   * Once configured, the device will push incoming SMS to your server.
   * 
   * @param webhookUrl The full URL of your server webhook endpoint
   */
  async setSMSWebhook(webhookUrl: string): Promise<void> {
    const cmdUrl = this.buildURL('/goip_send_cmd.html');
    const command = {
      type: 'command',
      op: 'set',
      ports: '*',
      ['par_name(0)']: 'sms_url',
      ['value(0)']: webhookUrl
    };

    await axios.post(cmdUrl, command, {
      params: {
        username: this.username,
        password: this.password
      },
      headers: { 'Content-Type': 'application/json;charset=utf-8' }
    });
  }
}
