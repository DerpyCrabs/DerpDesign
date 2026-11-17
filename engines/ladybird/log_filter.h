#pragma once
#include <AK/RefPtr.h>
#include <LibCore/Notifier.h>
#include <array>
#include <cerrno>
#include <cstdio>
#include <fcntl.h>
#include <memory>
#include <string>
#include <string_view>
#include <unistd.h>

// The console callback carries inspection replies over IPC. Upstream also prints
// those replies to stderr; suppress only that duplicate transport record. Keep
// at most a short, undecided prefix, then stream ordinary lines verbatim.
class ProtocolStderrFilter {
public:
  static std::unique_ptr<ProtocolStderrFilter> create() {
    auto filter = std::unique_ptr<ProtocolStderrFilter>(new ProtocolStderrFilter);
    if (!filter->install()) return {};
    return filter;
  }
  ~ProtocolStderrFilter() {
    if (m_notifier) { m_notifier->set_enabled(false); m_notifier = nullptr; }
    if (m_saved >= 0) {
      if (m_installed) {
        fflush(stderr);
        dup2(m_saved, STDERR_FILENO);
        drain();
        if (m_mode == Mode::Prefix) forward(m_prefix);
      }
      close(m_saved);
    }
    if (m_read >= 0) close(m_read);
  }
  ProtocolStderrFilter(ProtocolStderrFilter const&) = delete;
  ProtocolStderrFilter& operator=(ProtocolStderrFilter const&) = delete;
private:
  ProtocolStderrFilter() = default;
  enum class Mode { Prefix, Forward, Drop };
  static constexpr size_t prefix_limit = 512;
  // Require the debug level and exact first argument, including closing quote.
  static constexpr std::string_view protocol_prefix = "\033[32;1m(js debug)\033[0m \"__DERPDESIGN_INSPECTION__\" \"";
  bool install() {
    int descriptors[2];
    if (pipe2(descriptors, O_CLOEXEC) < 0) return false;
    m_read = descriptors[0];
    m_saved = fcntl(STDERR_FILENO, F_DUPFD_CLOEXEC, 3);
    if (m_saved < 0) { close(descriptors[1]); return false; }
    if (fcntl(m_read, F_SETFL, fcntl(m_read, F_GETFL) | O_NONBLOCK) < 0) {
      close(descriptors[1]); return false;
    }
    fflush(stderr);
    if (dup2(descriptors[1], STDERR_FILENO) < 0) { close(descriptors[1]); return false; }
    close(descriptors[1]);
    m_installed = true;
    m_notifier = Core::Notifier::construct(m_read, Core::Notifier::Type::Read);
    m_notifier->on_activation = [this] { drain(); };
    return true;
  }
  void forward(std::string_view bytes) {
    while (!bytes.empty()) {
      auto written = write(m_saved, bytes.data(), bytes.size());
      if (written < 0 && errno == EINTR) continue;
      if (written <= 0) return;
      bytes.remove_prefix(static_cast<size_t>(written));
    }
  }
  void consume(std::string_view bytes) {
    for (char byte : bytes) {
      if (m_mode == Mode::Prefix) {
        m_prefix += byte;
        if (m_prefix.find(protocol_prefix) != std::string::npos) {
          m_prefix.clear(); m_mode = Mode::Drop;
        } else if (byte == '\n' || m_prefix.size() == prefix_limit) {
          forward(m_prefix); m_prefix.clear();
          m_mode = byte == '\n' ? Mode::Prefix : Mode::Forward;
        }
      } else {
        // Forward an ordinary line in chunks, rather than one syscall per byte.
        if (m_mode == Mode::Forward) m_output[m_output_size++] = byte;
        if (m_output_size == m_output.size()) flush_output();
        if (byte == '\n') { flush_output(); m_mode = Mode::Prefix; }
      }
    }
    flush_output();
  }
  void flush_output() {
    if (m_output_size) forward({m_output.data(), m_output_size});
    m_output_size = 0;
  }
  void drain() {
    std::array<char, 16384> buffer;
    size_t drained = 0;
    while (drained < 256 * 1024) {
      auto count = read(m_read, buffer.data(), buffer.size());
      if (count > 0) { drained += static_cast<size_t>(count); consume({buffer.data(), static_cast<size_t>(count)}); continue; }
      if (count < 0 && errno == EINTR) continue;
      return;
    }
  }
  int m_read = -1, m_saved = -1;
  bool m_installed = false;
  RefPtr<Core::Notifier> m_notifier;
  Mode m_mode = Mode::Prefix;
  std::string m_prefix;
  std::array<char, 4096> m_output;
  size_t m_output_size = 0;
};
