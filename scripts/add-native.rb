# Adds Aurora's native code and the embedded Python to Capacitor's generated Xcode project.
# Runs in CI after `npx cap add ios` (needs the xcodeproj gem, which ships with CocoaPods).
#   ruby scripts/add-native.rb ios/App
require 'xcodeproj'

app_dir = ARGV[0] || 'ios/App'
proj = Xcodeproj::Project.open(File.join(app_dir, 'App.xcodeproj'))
target = proj.targets.find { |t| t.name == 'App' } or abort('App target not found')
group = proj.main_group.children.find { |g| g.respond_to?(:path) && (g.path == 'App' || g.display_name == 'App') } or abort('App group not found')

def add_file(group, target, name, compile)
  ref = group.files.find { |f| f.path == name } || group.new_reference(name)
  target.add_file_references([ref]) if compile && !target.source_build_phase.files_references.include?(ref)
  ref
end

# 1) native sources (copied into ios/App/App by the workflow)
%w[AuroraPython.h App-Bridging-Header.h].each { |f| add_file(group, target, f, false) }
%w[AuroraPython.m AuroraDLPlugin.swift FastFetch.swift AuroraViewController.swift].each { |f| add_file(group, target, f, true) }

# 2) Python code folders (blue folder references, copied as-is into the app bundle).
#    Not called "app": on macOS file names ignore case, so it would collide with the "App" executable.
%w[aurora_app app_packages].each do |dir|
  ref = group.children.find { |c| c.path == dir } || group.new_reference(dir)
  ref.last_known_file_type = 'folder'
  target.resources_build_phase.add_file_reference(ref, true)
end

# 3) Python.xcframework: link + embed
fw = proj.frameworks_group.files.find { |f| f.path == 'Python.xcframework' } || proj.frameworks_group.new_reference('Python.xcframework')
fw.source_tree = 'SOURCE_ROOT'
fw.last_known_file_type = 'wrapper.xcframework'
target.frameworks_build_phase.add_file_reference(fw, true)
embed = target.copy_files_build_phases.find { |p| p.symbol_dst_subfolder_spec == :frameworks } || begin
  p = target.new_copy_files_build_phase('Embed Frameworks')
  p.symbol_dst_subfolder_spec = :frameworks
  p
end
unless embed.files_references.include?(fw)
  bf = embed.add_file_reference(fw, true)
  bf.settings = { 'ATTRIBUTES' => %w[CodeSignOnCopy RemoveHeadersOnCopy] }
end

# 4) "Process Python libraries" script: copies the standard library and turns .so modules into frameworks.
#    It must run after resources are copied and before frameworks are embedded.
phase = target.shell_script_build_phases.find { |p| p.name == 'Process Python libraries' } || target.new_shell_script_build_phase('Process Python libraries')
phase.shell_path = '/bin/bash'
phase.always_out_of_date = '1' if phase.respond_to?(:always_out_of_date=)
phase.shell_script = <<~SH
  set -e
  # unsigned CI builds have no identity: sign ad-hoc; Sideloadly re-signs everything later
  if [ -z "$EXPANDED_CODE_SIGN_IDENTITY" ]; then export EXPANDED_CODE_SIGN_IDENTITY="-"; fi
  UTILS="$PROJECT_DIR/Python.xcframework/build/build_utils.sh"
  [ -f "$UTILS" ] || UTILS="$PROJECT_DIR/Python.xcframework/build/utils.sh"
  source "$UTILS"
  install_python Python.xcframework aurora_app app_packages
SH
target.build_phases.delete(phase)
idx = target.build_phases.index(embed) || target.build_phases.length
target.build_phases.insert(idx, phase)

# 5) build settings
target.build_configurations.each do |c|
  s = c.build_settings
  s['ENABLE_USER_SCRIPT_SANDBOXING'] = 'NO'
  s['FRAMEWORK_SEARCH_PATHS'] = ['$(inherited)', '"$(PROJECT_DIR)"']
  s['HEADER_SEARCH_PATHS'] = ['$(inherited)', '"$(BUILT_PRODUCTS_DIR)/Python.framework/Headers"']
  s['CLANG_WARN_QUOTED_INCLUDE_IN_FRAMEWORK_HEADER'] = 'NO'
  s['SWIFT_OBJC_BRIDGING_HEADER'] = 'App/App-Bridging-Header.h'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'
end

proj.save
puts 'add-native: Aurora native code and Python added to the Xcode project'
puts "build phases: #{target.build_phases.map(&:display_name).join(' -> ')}"
