using System;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace Fairy.Broker;

/// <summary>
/// Broker host process: newline-delimited JSON over a named pipe
/// (Windows: \\.\pipe\fairy-broker; Unix: /tmp/CoreFxPipe_fairy-broker).
/// One client at a time; every failure is a ok:false response, never a crash.
/// </summary>
public static class Program
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true,
    };

    public static async Task<int> Main(string[] args)
    {
        var pipeName = args.Length > 0 ? args[0] : BrokerHost.DefaultPipeName;
        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true;
            cts.Cancel();
        };

        Console.WriteLine($"[broker] listening on pipe '{pipeName}' (protocol v{BrokerHost.ProtocolVersion})");
        var host = new BrokerHost();
        while (!cts.IsCancellationRequested)
        {
            NamedPipeServerStream? server = null;
            try
            {
                server = new NamedPipeServerStream(
                    pipeName, PipeDirection.InOut, maxNumberOfServerInstances: 1,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
                await server.WaitForConnectionAsync(cts.Token);
                await ServeClientAsync(server, host);
                if (server.IsConnected) server.Disconnect();
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[broker] connection error: {ex.Message}");
            }
            finally
            {
                server?.Dispose();
            }
        }
        Console.WriteLine("[broker] shutdown");
        return 0;
    }

    /// <summary>Serve one connected client until it disconnects. Public for tests.</summary>
    public static async Task ServeClientAsync(PipeStream stream, BrokerHost host)
    {
        var encoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
        using var reader = new StreamReader(stream, encoding, detectEncodingFromByteOrderMarks: false,
            bufferSize: 1024, leaveOpen: true);
        using var writer = new StreamWriter(stream, encoding, bufferSize: 1024, leaveOpen: true) { AutoFlush = true };

        while (await reader.ReadLineAsync() is { } line)
        {
            BrokerResponse response;
            try
            {
                var wire = JsonSerializer.Deserialize<WireRequest>(line, JsonOpts);
                response = wire is null || wire.Id is null || wire.Op is null
                    ? BrokerResponse.Fail(wire?.Id ?? string.Empty, "malformed request envelope")
                    : host.HandleRequest(new BrokerRequest(wire.Id, wire.Op, wire.Payload));
            }
            catch (JsonException jex)
            {
                response = BrokerResponse.Fail(string.Empty, $"malformed JSON: {jex.Message}");
            }
            await writer.WriteLineAsync(JsonSerializer.Serialize(response, JsonOpts));
        }
    }

    private sealed class WireRequest
    {
        [System.Text.Json.Serialization.JsonPropertyName("id")]
        public string? Id { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("op")]
        public string? Op { get; set; }

        [System.Text.Json.Serialization.JsonPropertyName("payload")]
        public JsonElement? Payload { get; set; }
    }
}
