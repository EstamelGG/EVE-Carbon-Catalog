class MissingResourceError(FileNotFoundError):
    """An authored resource is absent from the client's resource index."""
    def __init__(self, resource):
        self.resource = resource
        super().__init__('客户端缺少资源索引: ' + resource)
